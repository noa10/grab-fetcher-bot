const logger = require('../utils/logger');
const { 
  parsePrice, 
  validateOrderData, 
  isWithinLastMinutes,
  sleep,
  randomDelay
} = require('../utils/helpers');

class OrderExtractor {
  constructor(page) {
    this.page = page;
    this.lastPollTime = null;
  }

  /**
   * Extract orders from the current page
   */
  async extractOrders() {
    try {
      logger.order('Starting order extraction...');
      
      if (!this.page) {
        throw new Error('Page not available for order extraction');
      }

      // Wait for orders to load
      await this.page.waitForSelector('table, .order-list, .order-item, [data-testid*="order"]', {
        timeout: 10000
      });

      // Add delay to ensure content is fully loaded
      await sleep(2000);

      // Extract order data using multiple strategies
      const orders = await this.page.evaluate(() => {
        const extractedOrders = [];

        // Helper function to extract order data from a DOM element
        const extractOrderFromElement = (element, index) => {
          try {
            // Helper function to find text by various selectors
            const findText = (selectors) => {
              for (const selector of selectors) {
                const el = element.querySelector(selector);
                if (el && el.textContent.trim()) {
                  return el.textContent.trim();
                }
              }
              return null;
            };

            // Helper function to find price
            const findPrice = (selectors) => {
              for (const selector of selectors) {
                const el = element.querySelector(selector);
                if (el && el.textContent.trim()) {
                  const text = el.textContent.trim();
                  const priceMatch = text.match(/[\d,]+\.?\d*/);
                  if (priceMatch) {
                    return parseFloat(priceMatch[0].replace(/,/g, ''));
                  }
                }
              }
              return 0;
            };

            // Extract order number
            const orderNumber = findText([
              '[data-testid*="order-number"]',
              '.order-number',
              '.order-id',
              'td:first-child',
              '[class*="order-number"]',
              '[class*="order-id"]'
            ]) || `ORDER_${Date.now()}_${index}`;

            // Extract customer name
            const customerName = findText([
              '[data-testid*="customer"]',
              '.customer-name',
              '.customer',
              'td:nth-child(2)',
              '[class*="customer"]'
            ]) || 'Unknown Customer';

            // Extract driver name
            const driverName = findText([
              '[data-testid*="driver"]',
              '.driver-name',
              '.driver',
              '[class*="driver"]'
            ]) || 'Pending';

            // Extract restaurant/merchant name
            const restaurantName = findText([
              '[data-testid*="restaurant"]',
              '.restaurant-name',
              '.merchant-name',
              '[class*="restaurant"]',
              '[class*="merchant"]'
            ]) || 'Unknown Restaurant';

            // Extract order status
            const status = findText([
              '[data-testid*="status"]',
              '.status',
              '.order-status',
              '[class*="status"]'
            ]) || 'pending';

            // Extract pricing information
            const total = findPrice([
              '[data-testid*="total"]',
              '.total',
              '.order-total',
              '.price',
              '[class*="total"]',
              '[class*="price"]'
            ]);

            const subtotal = findPrice([
              '[data-testid*="subtotal"]',
              '.subtotal',
              '[class*="subtotal"]'
            ]) || total;

            const deliveryFee = findPrice([
              '[data-testid*="delivery"]',
              '.delivery-fee',
              '[class*="delivery"]'
            ]);

            // Extract timestamp
            const timestampText = findText([
              '[data-testid*="time"]',
              '.timestamp',
              '.order-time',
              '.time',
              '[class*="time"]'
            ]);

            let orderTimestamp = new Date();
            if (timestampText) {
              // Try to parse various timestamp formats
              const timeFormats = [
                /(\d{1,2}):(\d{2})\s*(AM|PM)/i,
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
                /(\d{4})-(\d{2})-(\d{2})/
              ];

              for (const format of timeFormats) {
                const match = timestampText.match(format);
                if (match) {
                  try {
                    orderTimestamp = new Date(timestampText);
                    break;
                  } catch (e) {
                    // Continue to next format
                  }
                }
              }
            }

            // Extract delivery address
            const deliveryAddress = findText([
              '[data-testid*="address"]',
              '.address',
              '.delivery-address',
              '[class*="address"]'
            ]);

            // Build order object
            const orderData = {
              orderNumber: orderNumber,
              customerName: customerName,
              driverName: driverName,
              orderDetails: {
                restaurantName: restaurantName,
                orderType: 'delivery',
                items: [], // Will be populated if we can extract item details
                specialInstructions: ''
              },
              pricing: {
                subtotal: subtotal,
                deliveryFee: deliveryFee,
                serviceFee: 0,
                tax: 0,
                discount: 0,
                total: total,
                currency: 'SGD'
              },
              deliveryInfo: {
                address: deliveryAddress,
                coordinates: {
                  latitude: null,
                  longitude: null
                },
                estimatedDeliveryTime: null,
                actualDeliveryTime: null
              },
              status: status.toLowerCase(),
              orderTimestamp: orderTimestamp,
              screenshotPath: null,
              screenshotUrl: null,
              source: 'grab-merchant-portal',
              rawData: {
                extractedAt: new Date(),
                elementIndex: index,
                originalText: element.textContent.trim()
              }
            };

            return orderData;
          } catch (error) {
            console.log('Error in extractOrderFromElement:', error);
            return null;
          }
        };

        // Strategy 1: Look for table rows
        const tableRows = document.querySelectorAll('table tbody tr, .order-row, .order-item');

        tableRows.forEach((row, index) => {
          try {
            const orderData = extractOrderFromElement(row, index);
            if (orderData && orderData.orderNumber) {
              extractedOrders.push(orderData);
            }
          } catch (error) {
            console.log('Error extracting order from row:', error);
          }
        });

        // Strategy 2: Look for card-based layouts
        if (extractedOrders.length === 0) {
          const orderCards = document.querySelectorAll('.order-card, .card, [class*="order"]');

          orderCards.forEach((card, index) => {
            try {
              const orderData = extractOrderFromElement(card, index);
              if (orderData && orderData.orderNumber) {
                extractedOrders.push(orderData);
              }
            } catch (error) {
              console.log('Error extracting order from card:', error);
            }
          });
        }

        return extractedOrders;
      });

      // Filter orders to only include new ones since last poll
      const newOrders = this.filterNewOrders(orders);
      
      logger.order(`Extracted ${orders.length} total orders, ${newOrders.length} new orders`);
      
      return newOrders;
    } catch (error) {
      logger.error('Failed to extract orders:', error);
      return [];
    }
  }



  /**
   * Filter orders to only include new ones since last poll
   */
  filterNewOrders(orders) {
    if (!this.lastPollTime) {
      // First poll - consider all orders from last 15 minutes as new
      this.lastPollTime = new Date(Date.now() - (15 * 60 * 1000));
    }

    const newOrders = orders.filter(order => {
      return order.orderTimestamp > this.lastPollTime;
    });

    // Update last poll time
    this.lastPollTime = new Date();

    return newOrders;
  }

  /**
   * Extract detailed order information by clicking on an order
   */
  async extractDetailedOrderInfo(orderElement) {
    try {
      logger.order('Extracting detailed order information...');
      
      // Click on the order to open details
      await orderElement.click();
      
      // Wait for details to load
      await sleep(randomDelay(1000, 2000));
      
      // Wait for detail modal or page to load
      await this.page.waitForSelector('.order-details, .modal, .detail-view', {
        timeout: 5000
      });

      // Extract additional details
      const detailedInfo = await this.page.evaluate(() => {
        const details = {};
        
        // Extract order items
        const itemElements = document.querySelectorAll('.order-item, .item, .product');
        details.items = Array.from(itemElements).map(item => {
          const name = item.querySelector('.item-name, .product-name')?.textContent?.trim() || '';
          const quantity = item.querySelector('.quantity')?.textContent?.trim() || '1';
          const price = item.querySelector('.price')?.textContent?.trim() || '0';
          
          return {
            name: name,
            quantity: parseInt(quantity) || 1,
            price: parseFloat(price.replace(/[^\d.]/g, '')) || 0,
            notes: item.querySelector('.notes, .special-instructions')?.textContent?.trim() || ''
          };
        });

        // Extract special instructions
        details.specialInstructions = document.querySelector('.special-instructions, .notes, .instructions')?.textContent?.trim() || '';

        // Extract more precise timing information
        const timeElements = document.querySelectorAll('[class*="time"], [class*="timestamp"]');
        details.timestamps = Array.from(timeElements).map(el => el.textContent.trim());

        return details;
      });

      // Close detail view if it's a modal
      try {
        const closeButton = await this.page.$('.close, .modal-close, [aria-label="close"]');
        if (closeButton) {
          await closeButton.click();
          await sleep(500);
        }
      } catch (e) {
        // Ignore if no close button found
      }

      return detailedInfo;
    } catch (error) {
      logger.error('Failed to extract detailed order info:', error);
      return {};
    }
  }

  /**
   * Validate extracted order data
   */
  validateExtractedOrder(orderData) {
    const validation = validateOrderData(orderData);
    
    if (!validation.isValid) {
      logger.warn('Order validation failed:', {
        orderNumber: orderData.orderNumber,
        errors: validation.errors
      });
    }

    return validation;
  }

  /**
   * Set the last poll time (useful for initialization)
   */
  setLastPollTime(timestamp) {
    this.lastPollTime = timestamp;
  }

  /**
   * Get the last poll time
   */
  getLastPollTime() {
    return this.lastPollTime;
  }
}

module.exports = OrderExtractor;
