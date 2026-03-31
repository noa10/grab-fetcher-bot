const logger = require('../utils/logger');
const {
  parsePrice,
  validateOrderData,
  isWithinLastMinutes,
  sleep,
  randomDelay,
  parseGrabTimestamp
} = require('../utils/helpers');

class OrderExtractor {
  constructor(page) {
    this.page = page;
    this.lastPollTime = null;
    this.processedOrderIds = new Set();
  }

  async extractOrders() {
    try {
      logger.order('Starting order extraction from History tab...');

      if (!this.page || this.page.isClosed()) {
        throw new Error('Page not available for order extraction');
      }

      try {
        await this.page.waitForSelector('.history-table-list, .dui-table-body', { timeout: 10000 });
      } catch (e) {
        logger.order('Table selector not found, checking page state...');
        const pageState = await this.page.evaluate(() => ({
          url: window.location.href,
          hasHistoryTable: !!document.querySelector('.history-table-list'),
          hasTableBody: !!document.querySelector('.dui-table-body'),
          bodyText: document.body.textContent.substring(0, 300)
        }));
        logger.order('Page state:', JSON.stringify(pageState));
        if (!pageState.hasHistoryTable && !pageState.hasTableBody) {
          return [];
        }
      }

      await sleep(2000);

      const orderList = await this.extractOrderListFromTable();
      logger.order(`Found ${orderList.length} orders in history table`);

      if (orderList.length === 0) {
        return [];
      }

      const detailedOrders = [];
      
      for (let i = 0; i < orderList.length; i++) {
        const orderSummary = orderList[i];
        const orderKey = `${orderSummary.shortOrderId}|${orderSummary.longOrderId}`;
        if (this.processedOrderIds.has(orderKey)) {
          continue;
        }

        logger.order(`Processing order ${i + 1}/${orderList.length}: ${orderSummary.shortOrderId}`);
        
        try {
          if (!this.page || this.page.isClosed()) {
            logger.order('Page is closed, using fallback for remaining orders');
            for (let j = i; j < orderList.length; j++) {
              const remaining = orderList[j];
              const remainingKey = `${remaining.shortOrderId}|${remaining.longOrderId}`;
              if (!this.processedOrderIds.has(remainingKey)) {
                detailedOrders.push(this.createFallbackOrder(remaining));
                this.processedOrderIds.add(remainingKey);
              }
            }
            break;
          }

          const drawerOpened = await this.clickOrderRowAndWait(i);
          
          if (drawerOpened) {
            await sleep(1500);
            const detailedOrder = await this.extractOrderDetailsFromDrawer(orderSummary);
            
            if (detailedOrder) {
              detailedOrders.push(detailedOrder);
              this.processedOrderIds.add(orderKey);
            }
            
            await this.closeOrderDrawer();
          } else {
            logger.order(`Drawer did not open for order ${orderSummary.shortOrderId}, using table data`);
            const fallbackOrder = this.createFallbackOrder(orderSummary);
            detailedOrders.push(fallbackOrder);
            this.processedOrderIds.add(orderKey);
          }
          
          await sleep(500);
          
        } catch (error) {
          if (error.message && error.message.includes('detached')) {
            logger.order(`Frame detached at order ${orderSummary.shortOrderId}, using fallback for remaining orders`);
            for (let j = i; j < orderList.length; j++) {
              const remaining = orderList[j];
              const remainingKey = `${remaining.shortOrderId}|${remaining.longOrderId}`;
              if (!this.processedOrderIds.has(remainingKey)) {
                detailedOrders.push(this.createFallbackOrder(remaining));
                this.processedOrderIds.add(remainingKey);
              }
            }
            break;
          }
          logger.error(`Failed to extract details for order ${orderSummary.shortOrderId}:`, error.message);
          try {
            await this.closeOrderDrawer();
          } catch (e) {}
          await sleep(1000);
        }
      }

      const newOrders = this.filterNewOrders(detailedOrders);
      logger.order(`Extracted ${detailedOrders.length} total orders, ${newOrders.length} new orders`);
      
      return newOrders;
    } catch (error) {
      logger.error('Failed to extract orders:', error);
      throw error;
    }
  }

  async extractOrderListFromTable() {
    try {
      const orders = await this.page.evaluate(() => {
        const extractedOrders = [];
        
        const tableWrapper = document.querySelector('.history-table-list');
        if (!tableWrapper) {
          return [];
        }

        const allRows = tableWrapper.querySelectorAll('.dui-table-body tbody tr');
        const rows = Array.from(allRows).filter(row => {
          if (row.getAttribute('aria-hidden') === 'true') return false;
          if (row.classList.contains('dui-table-measure-row')) return false;
          if (row.offsetHeight === 0) return false;
          return true;
        });
        
        rows.forEach((row, index) => {
          try {
            const cells = row.querySelectorAll('.dui-table-cell');
            
            if (cells.length < 4) {
              return;
            }

            const longOrderId = cells[1]?.textContent?.trim() || '';
            const shortOrderId = cells[2]?.textContent?.trim() || '';
            const totalAmountText = cells[3]?.textContent?.trim() || '';
            const statusText = cells[4]?.textContent?.trim() || '';

            const totalMatch = totalAmountText.match(/([A-Z]{3})\s*([\d,]+\.?\d*)/);
            const currency = totalMatch ? totalMatch[1] : 'MYR';
            const totalAmount = totalMatch ? parseFloat(totalMatch[2].replace(/,/g, '')) : 0;

            let status = 'unknown';
            const statusLower = statusText.toLowerCase();
            if (statusLower.includes('complet')) status = 'completed';
            else if (statusLower.includes('cancel')) status = 'cancelled';
            else if (statusLower.includes('process')) status = 'processing';
            else if (statusLower.includes('prepar')) status = 'preparing';
            else if (statusLower.includes('deliver')) status = 'delivered';
            else if (statusLower.includes('pending')) status = 'pending';
            else if (statusText && !/^\d/.test(statusText)) status = statusText;

            extractedOrders.push({
              rowId: index,
              longOrderId,
              shortOrderId,
              totalAmount,
              currency,
              status,
              statusText
            });
          } catch (error) {
            console.log('Error extracting row:', error);
          }
        });
        
        return extractedOrders;
      });

      return orders;
    } catch (error) {
      logger.error('Failed to extract order list from table:', error);
      return [];
    }
  }

  async clickOrderRowAndWait(rowIndex) {
    try {
      await this.clickOrderRow(rowIndex);
      
      const drawerOpen = await this.waitForDrawer(3000);
      if (drawerOpen) return true;
      
      await sleep(1000);
      await this.closeOrderDrawer();
      await sleep(500);
      
      await this.clickOrderRow(rowIndex);
      const retryOpen = await this.waitForDrawer(3000);
      return retryOpen;
    } catch (error) {
      if (error.message && error.message.includes('detached')) {
        throw error;
      }
      return false;
    }
  }

  async clickOrderRow(rowIndex) {
    try {
      const clicked = await this.page.evaluate((index) => {
        const tableWrapper = document.querySelector('.history-table-list');
        if (!tableWrapper) return false;
        
        const allRows = tableWrapper.querySelectorAll('.dui-table-body tbody tr');
        const rows = Array.from(allRows).filter(row => {
          if (row.getAttribute('aria-hidden') === 'true') return false;
          if (row.classList.contains('dui-table-measure-row')) return false;
          if (row.offsetHeight === 0) return false;
          return true;
        });
        
        if (rows[index]) {
          rows[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
          rows[index].click();
          return true;
        }
        return false;
      }, rowIndex);
      
      if (clicked) {
        logger.order(`Clicked on order row ${rowIndex}`);
      } else {
        logger.order(`Could not find order row ${rowIndex}`);
      }
    } catch (error) {
      if (error.message && error.message.includes('detached')) {
        throw error;
      }
      logger.error('Failed to click order row:', error);
    }
  }

  async waitForDrawer(timeout = 3000) {
    try {
      await this.page.waitForSelector('.dui-drawer-content, [role="dialog"]', { timeout });
      return true;
    } catch (e) {
      if (e.message && e.message.includes('detached')) {
        throw e;
      }
      return false;
    }
  }

  async extractOrderDetailsFromDrawer(orderSummary) {
    try {
      const hasDrawer = await this.page.evaluate(() => {
        return !!document.querySelector('.dui-drawer-content, .OrderDetailDrawer, [role="dialog"]');
      });

      if (!hasDrawer) {
        return this.createFallbackOrder(orderSummary);
      }

      await sleep(1000);

      const detailedData = await this.page.evaluate((summary) => {
        try {
          const data = {
            orderNumber: summary.shortOrderId,
            longOrderId: summary.longOrderId,
            bookingId: '',
            driverPhotoUrl: '',
            driverName: '',
            driverPhone: '',
            driverStatus: '',
            orderTimestamp: '',
            customerName: '',
            customerPhone: '',
            customerNote: '',
            orderItems: [],
            pricing: {
              subtotal: 0,
              discount: 0,
              total: 0,
              currency: summary.currency || 'MYR'
            }
          };

          const bookingIdRow = document.querySelector('.dui-card-body .dui-row');
          if (bookingIdRow) {
            const bookingCells = bookingIdRow.parentElement?.querySelectorAll(':scope > .dui-row');
            if (bookingCells && bookingCells.length > 1) {
              const bookingValueRow = bookingCells[1];
              const bookingText = bookingValueRow?.textContent?.trim();
              if (bookingText && bookingText.match(/^[A-Z0-9-]+$/)) {
                data.bookingId = bookingText;
              }
            }
          }

          const displayIdEl = document.querySelector('[data-testid="displayOfDisplayID"]');
          if (displayIdEl) {
            data.orderNumber = displayIdEl.textContent.trim();
          }

          const orderIdLink = document.querySelector('[data-testid="displayOfOrderID"] a');
          if (orderIdLink) {
            data.longOrderId = orderIdLink.textContent.trim();
          }

          const driverStateEl = document.querySelector('[data-testid="driverState"]');
          if (driverStateEl) {
            data.driverStatus = driverStateEl.textContent.trim();
          }

          const driverCard = document.querySelector('.dui-card-head-title');
          if (driverCard && driverCard.textContent.trim() === 'Driver') {
            const driverCardBody = driverCard.closest('.dui-card')?.querySelector('.dui-card-body');
            if (driverCardBody) {
              const driverPhoto = driverCardBody.querySelector('.dui-avatar img');
              if (driverPhoto) {
                data.driverPhotoUrl = driverPhoto.getAttribute('src') || '';
              }

              const driverNameEls = driverCardBody.querySelectorAll('.css-zep5kh-DriverDisplay');
              for (const el of driverNameEls) {
                if (el.getAttribute('data-testid') === 'driverState') continue;
                const text = el.textContent.trim();
                if (text && text.length > 2 && !data.driverName) {
                  data.driverName = text;
                }
              }

              const driverPhoneEl = driverCardBody.querySelector('.css-vodjec-DriverDisplay');
              if (driverPhoneEl) {
                const phoneText = driverPhoneEl.textContent.trim();
                if (phoneText && phoneText !== '-' && phoneText !== '–') {
                  const phoneMatch = phoneText.match(/[+📞\s\d]+/);
                  if (phoneMatch) {
                    data.driverPhone = phoneMatch[0].trim();
                  }
                }
              }

              const timestampEl = driverCardBody.querySelector('.css-e4jgmp-DriverDisplay');
              if (timestampEl) {
                data.orderTimestamp = timestampEl.textContent.trim();
              }
            }
          }

          const customerCard = document.querySelectorAll('.dui-card-head-title');
          for (const title of customerCard) {
            if (title.textContent.trim() === 'Customer') {
              const customerCardBody = title.closest('.dui-card')?.querySelector('.dui-card-body');
              if (customerCardBody) {
                const customerNameEl = customerCardBody.querySelector('.css-qbank5-CustomerDisplay');
                if (customerNameEl) {
                  const name = customerNameEl.textContent.trim();
                  data.customerName = (name && name !== '***') ? name : '';
                }

                const customerPhoneEl = customerCardBody.querySelector('[data-testid="eater-number"]');
                if (customerPhoneEl) {
                  const phoneText = customerPhoneEl.textContent.trim();
                  if (phoneText && phoneText !== '-' && phoneText !== '–') {
                    data.customerPhone = phoneText;
                  }
                }

                const customerNoteEl = customerCardBody.querySelector('[data-testid="eater-comment"]');
                if (customerNoteEl) {
                  data.customerNote = customerNoteEl.textContent.trim();
                }
              }
              break;
            }
          }

          const itemsTable = document.querySelector('.css-1q5gxb5-ItemDisplay table, table.css-s8gu33-ItemDisplay');
          if (itemsTable) {
            const tbody = itemsTable.querySelector('tbody');
            if (tbody) {
              const rows = tbody.querySelectorAll('tr');
              let currentItemIndex = -1;
              
              for (const row of rows) {
                try {
                  const cells = row.querySelectorAll('td');
                  if (cells.length < 2) continue;

                  const firstCellText = cells[0]?.textContent?.trim() || '';
                  const firstCellLower = firstCellText.toLowerCase();

                  if (firstCellLower.includes('subtotal')) {
                    const valueText = cells[cells.length - 1]?.textContent?.trim() || '';
                    const valueMatch = valueText.match(/RM\s*([\d,]+\.?\d*)/);
                    if (valueMatch) {
                      data.pricing.subtotal = parseFloat(valueMatch[1].replace(/,/g, ''));
                    }
                    continue;
                  }
                  
                  if (firstCellLower.includes('total') && !firstCellLower.includes('subtotal')) {
                    const valueText = cells[cells.length - 1]?.textContent?.trim() || '';
                    const valueMatch = valueText.match(/RM\s*([\d,]+\.?\d*)/);
                    if (valueMatch) {
                      data.pricing.total = parseFloat(valueMatch[1].replace(/,/g, ''));
                    }
                    continue;
                  }

                  if (row.getAttribute('data-testid') === 'order-level-discount') {
                    const lastCell = cells[cells.length - 1];
                    if (lastCell) {
                      const discountText = lastCell.textContent.trim();
                      const discountMatch = discountText.match(/(-?[\d,]+\.?\d*)/);
                      if (discountMatch) {
                        data.pricing.discount = parseFloat(discountMatch[1].replace(/,/g, ''));
                      }
                    }
                    continue;
                  }

                  const itemNameEl = row.querySelector('[data-testid="item-name"]');
                  
                  if (itemNameEl) {
                    const itemName = itemNameEl.textContent.trim();
                    const priceText = cells[1]?.textContent?.trim() || '0';
                    const quantityText = cells[2]?.textContent?.trim() || '1';
                    const totalText = cells[3]?.textContent?.trim() || '0';

                    const price = parseFloat(priceText.replace(/[^0-9.-]/g, '')) || 0;
                    const quantity = parseInt(quantityText) || 1;
                    const total = parseFloat(totalText.replace(/[^0-9.-]/g, '')) || 0;

                    const discountEl = row.querySelector('[data-testid="item-level-discount"]');
                    let discountInfo = '';
                    if (discountEl) {
                      discountInfo = discountEl.textContent.trim();
                    }

                    data.orderItems.push({
                      name: itemName,
                      price,
                      quantity,
                      total,
                      discount: discountInfo,
                      modifiers: []
                    });
                    currentItemIndex = data.orderItems.length - 1;
                  } else if (currentItemIndex >= 0 && row.className?.includes('css-h6k0xq')) {
                    const optionName = cells[0]?.textContent?.trim() || '';
                    const lines = optionName.split('\n').map(l => l.trim()).filter(l => l);
                    if (lines.length >= 2) {
                      data.orderItems[currentItemIndex].modifiers.push({
                        name: lines[0],
                        value: lines[1]
                      });
                    }
                  }

                } catch (e) {
                  console.log('Error extracting item row:', e);
                }
              }
            }
          }

          return data;
        } catch (error) {
          console.log('Error in extractOrderDetailsFromDrawer evaluate:', error);
          return null;
        }
      }, orderSummary);

      if (!detailedData) {
        return this.createFallbackOrder(orderSummary);
      }

      const order = {
        orderNumber: detailedData.orderNumber || orderSummary.shortOrderId,
        longOrderId: detailedData.longOrderId || orderSummary.longOrderId || '',
        bookingId: detailedData.bookingId || '',
        customerName: detailedData.customerName || 'Customer',
        customerPhone: detailedData.customerPhone || '',
        customerNote: detailedData.customerNote || '',
        driverName: detailedData.driverName || 'Pending',
        driverPhone: detailedData.driverPhone || '',
        driverPhotoUrl: detailedData.driverPhotoUrl || '',
        driverStatus: detailedData.driverStatus || '',
        deliveryTime: '',
        orderTimestamp: parseGrabTimestamp(detailedData.orderTimestamp),
        orderDetails: {
          restaurantName: 'Grab Order',
          orderType: 'delivery',
          items: detailedData.orderItems || [],
          specialInstructions: detailedData.customerNote || ''
        },
        pricing: {
          subtotal: detailedData.pricing.subtotal || 0,
          deliveryFee: 0,
          serviceFee: 0,
          tax: 0,
          discount: detailedData.pricing.discount || 0,
          total: detailedData.pricing.total || orderSummary.totalAmount || 0,
          currency: detailedData.pricing.currency || 'MYR'
        },
        deliveryInfo: {
          address: '',
          coordinates: { latitude: null, longitude: null },
          estimatedDeliveryTime: null,
          actualDeliveryTime: null
        },
        status: orderSummary.status || 'pending',
        screenshotPath: null,
        screenshotUrl: null,
        source: 'grab-merchant-portal-history',
        rawData: {
          extractedAt: new Date().toISOString(),
          longOrderId: detailedData.longOrderId,
          shortOrderId: detailedData.orderNumber,
          driverStatus: detailedData.driverStatus,
          orderTimestamp: detailedData.orderTimestamp
        },
        _preserveCustomerName: !detailedData.customerName || detailedData.customerName === ''
      };

      return order;
    } catch (error) {
      logger.error('Failed to extract order details from drawer:', error);
      return this.createFallbackOrder(orderSummary);
    }
  }

  createFallbackOrder(orderSummary) {
    return {
      orderNumber: orderSummary.shortOrderId || `ORDER_${Date.now()}`,
      longOrderId: orderSummary.longOrderId || '',
      bookingId: '',
      customerName: 'Customer',
      customerPhone: '',
      customerNote: '',
      driverName: 'Pending',
      driverPhone: '',
      driverPhotoUrl: '',
      driverStatus: '',
      deliveryTime: '',
      orderTimestamp: new Date(),
      orderDetails: {
        restaurantName: 'Grab Order',
        orderType: 'delivery',
        items: [],
        specialInstructions: ''
      },
      pricing: {
        subtotal: orderSummary.totalAmount || 0,
        deliveryFee: 0,
        serviceFee: 0,
        tax: 0,
        discount: 0,
        total: orderSummary.totalAmount || 0,
        currency: orderSummary.currency || 'MYR'
      },
      deliveryInfo: {
        address: '',
        coordinates: { latitude: null, longitude: null },
        estimatedDeliveryTime: null,
        actualDeliveryTime: null
      },
      status: orderSummary.status || 'unknown',
      screenshotPath: null,
      screenshotUrl: null,
      source: 'grab-merchant-portal-history',
      rawData: {
        extractedAt: new Date().toISOString(),
        longOrderId: orderSummary.longOrderId,
        shortOrderId: orderSummary.shortOrderId,
        note: 'Fallback - drawer extraction failed'
      },
      _preserveCustomerName: false
    };
  }

  async closeOrderDrawer() {
    try {
      await this.page.evaluate(() => {
        const closeBtn = document.querySelector('.dui-drawer-close, button[aria-label="Close"], .dui-drawer-header button');
        if (closeBtn) {
          closeBtn.click();
          return;
        }
        const overlay = document.querySelector('.dui-drawer-mask, .ant-drawer-mask, [class*="drawer-mask"]');
        if (overlay) {
          overlay.click();
          return;
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      });
      await sleep(300);
    } catch (error) {
    }
  }

  filterNewOrders(orders) {
    if (!this.lastPollTime) {
      logger.order('First poll - fetching all historical orders');
      this.lastPollTime = new Date(Date.now() - (365 * 24 * 60 * 60 * 1000));
    }

    const newOrders = orders.filter(order => {
      let orderDate;
      if (typeof order.orderTimestamp === 'string') {
        orderDate = new Date(order.orderTimestamp);
      } else if (order.orderTimestamp instanceof Date) {
        orderDate = order.orderTimestamp;
      } else {
        orderDate = new Date();
      }
      return orderDate > this.lastPollTime;
    });

    this.lastPollTime = new Date();
    return newOrders;
  }

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

  setLastPollTime(timestamp) {
    this.lastPollTime = timestamp;
  }

  getLastPollTime() {
    return this.lastPollTime;
  }

  clearProcessedOrders() {
    this.processedOrderIds.clear();
    logger.order('Cleared processed orders cache');
  }
}

module.exports = OrderExtractor;
