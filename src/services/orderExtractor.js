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
        logger.order(`Page state: hasTable=${pageState.hasHistoryTable || pageState.hasTableBody}, url=${pageState.url}`);
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

            // Status is read from cells[4], so a 4-cell row must be rejected —
            // the old `length < 4` guard let it through with statusText undefined.
            if (cells.length < 5) {
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
          // Defined inside the evaluate because it runs in the browser context.
          // Currency-agnostic: matches "RM 12.50", "SGD 12.50", "12.50", "-3.50".
          // The previous /RM\\s*(...)/ pattern silently returned 0 for non-MYR merchants.
          const matchAmount = (text) => {
            if (!text) return null;
            const m = String(text).match(/-?[\d,]+\.?\d*/);
            if (!m) return null;
            const value = parseFloat(m[0].replace(/,/g, ''));
            return isNaN(value) ? null : value;
          };

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
              tax: 0,
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

          // Driver card — locate by title text by iterating all card titles
          // (Driver may not be the first card). Stable anchors: .dui-avatar img
          // (photo) and [data-testid="driverState"] (status). Name/phone/
          // timestamp have no data-testid, so locate them structurally within
          // the .dui-row/.dui-col layout and fall back to the legacy hashed
          // css-xxxxx-DriverDisplay classes for older DOM builds.
          const cardTitles = document.querySelectorAll('.dui-card-head-title');
          for (const title of cardTitles) {
            if (title.textContent.trim() !== 'Driver') continue;
            const driverCardBody = title.closest('.dui-card')?.querySelector('.dui-card-body');
            if (!driverCardBody) break;

            const driverPhoto = driverCardBody.querySelector('.dui-avatar img');
            if (driverPhoto) {
              data.driverPhotoUrl = driverPhoto.getAttribute('src') || '';
            }

            const driverStateEl = driverCardBody.querySelector('[data-testid="driverState"]');
            if (driverStateEl) {
              data.driverStatus = driverStateEl.textContent.trim();
            }

            // Name + phone live in the .dui-col sibling of the avatar's col
            // (both children of the same inner .dui-row): first div = name,
            // second div = phone.
            const avatar = driverCardBody.querySelector('.dui-avatar');
            const avatarCol = avatar ? avatar.closest('.dui-col') : null;
            let namePhoneCol = null;
            if (avatarCol && avatarCol.parentElement) {
              for (const col of avatarCol.parentElement.children) {
                if (col !== avatarCol && col.classList.contains('dui-col')) {
                  namePhoneCol = col;
                  break;
                }
              }
            }
            const npDivs = namePhoneCol
              ? Array.from(namePhoneCol.children).filter(c => c.tagName === 'DIV')
              : [];
            const nameEl = npDivs[0] || null;
            const phoneEl = npDivs[1] || null;

            if (nameEl && nameEl.textContent.trim()) {
              data.driverName = nameEl.textContent.trim();
            } else {
              // Legacy fallback: hashed css-zep5kh-DriverDisplay (also matches
              // the driverState element, which we skip).
              const driverNameEls = driverCardBody.querySelectorAll('.css-zep5kh-DriverDisplay');
              for (const el of driverNameEls) {
                if (el.getAttribute('data-testid') === 'driverState') continue;
                const text = el.textContent.trim();
                if (text && text.length > 2 && !data.driverName) {
                  data.driverName = text;
                }
              }
            }

            const phoneText = phoneEl ? phoneEl.textContent.trim() : '';
            if (phoneText && phoneText !== '-' && phoneText !== '–') {
              const phoneMatch = phoneText.match(/[+📞\s\d]+/);
              if (phoneMatch) {
                data.driverPhone = phoneMatch[0].trim();
              }
            } else if (!data.driverPhone) {
              // Legacy fallback: hashed css-vodjec-DriverDisplay
              const driverPhoneEl = driverCardBody.querySelector('.css-vodjec-DriverDisplay');
              if (driverPhoneEl) {
                const legacyPhoneText = driverPhoneEl.textContent.trim();
                if (legacyPhoneText && legacyPhoneText !== '-' && legacyPhoneText !== '–') {
                  const phoneMatch = legacyPhoneText.match(/[+📞\s\d]+/);
                  if (phoneMatch) {
                    data.driverPhone = phoneMatch[0].trim();
                  }
                }
              }
            }

            // Timestamp is the sibling of driverState within its .dui-col.
            let timestampEl = null;
            if (driverStateEl && driverStateEl.parentElement) {
              for (const sib of driverStateEl.parentElement.children) {
                if (sib !== driverStateEl && sib.textContent.trim()) {
                  timestampEl = sib;
                  break;
                }
              }
            }
            if (timestampEl) {
              data.orderTimestamp = timestampEl.textContent.trim();
            } else if (driverCardBody) {
              // Fallback by shape, not by class: the hashed CSS-module names rotate
              // on every Grab deploy. See the note in extractOrdersForStateUpdate.
              const m = driverCardBody.innerText
                .match(/\d{1,2}\s+[A-Za-z]{3},\s*[A-Za-z]+,?\s*\d{1,2}:\d{2}\s*(AM|PM)/i);
              if (m) {
                data.orderTimestamp = m[0];
              }
            }

            break;
          }

          const customerCard = document.querySelectorAll('.dui-card-head-title');
          for (const title of customerCard) {
            if (title.textContent.trim() === 'Customer') {
              const customerCardBody = title.closest('.dui-card')?.querySelector('.dui-card-body');
              if (customerCardBody) {
                // Customer name has no data-testid. It is the first text div
                // in the first .dui-col of the card body, sitting beside the
                // [data-testid="eater-number"] phone element. Locate it
                // structurally, then fall back to the hashed class.
                let customerNameEl = null;
                const firstCol = customerCardBody.querySelector('.dui-row .dui-col');
                if (firstCol) {
                  for (const child of firstCol.children) {
                    if (child.tagName === 'DIV' &&
                        child.getAttribute('data-testid') !== 'eater-number' &&
                        child.textContent.trim()) {
                      customerNameEl = child;
                      break;
                    }
                  }
                }
                if (!customerNameEl) {
                  customerNameEl = customerCardBody.querySelector('.css-qbank5-CustomerDisplay');
                }
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

          // Locate the items table via the stable item-name test id. Grab's
          // css-xxxxx-ItemDisplay class names are build-hashed and change
          // between releases, so [data-testid="item-name"] is the reliable
          // anchor. Fall back to the legacy selectors for older DOM builds.
          const itemNameAnchor = document.querySelector('[data-testid="item-name"]');
          const itemsTable = itemNameAnchor
            ? itemNameAnchor.closest('table')
            : document.querySelector('.css-1q5gxb5-ItemDisplay table, table.css-s8gu33-ItemDisplay');
          if (itemsTable) {
            const tbody = itemsTable.querySelector('tbody') || itemsTable;
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
                    const valueMatch = matchAmount(valueText);
                    if (valueMatch) {
                      data.pricing.subtotal = valueMatch;
                    }
                    // Subtotal row may carry "Includes tax (RMx.xx)".
                    const taxMatch = firstCellText.match(/includes tax\s*\(RM\s*([\d,]+\.?\d*)\)/i);
                    if (taxMatch) {
                      data.pricing.tax = parseFloat(taxMatch[1].replace(/,/g, ''));
                    }
                    continue;
                  }

                  if (firstCellLower.includes('total') && !firstCellLower.includes('subtotal')) {
                    const valueText = cells[cells.length - 1]?.textContent?.trim() || '';
                    const valueMatch = matchAmount(valueText);
                    if (valueMatch) {
                      data.pricing.total = valueMatch;
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
                  } else if (currentItemIndex >= 0) {
                    // Modifier / option row. These rows have no item-name and
                    // are built from a .dui-row containing two .dui-col children
                    // (label + value). Parse structurally rather than relying on
                    // hashed <tr> class names (e.g. css-h6k0xq / YYfcqn2FGv5cUDyO3m0D).
                    const cols = row.querySelectorAll('.dui-row .dui-col');
                    if (cols.length >= 2) {
                      const modName = cols[0]?.textContent?.trim() || '';
                      const modValue = cols[1]?.textContent?.trim() || '';
                      if (modName && modValue) {
                        data.orderItems[currentItemIndex].modifiers.push({
                          name: modName,
                          value: modValue
                        });
                      }
                    } else if (row.className?.includes('css-h6k0xq')) {
                      // Legacy fallback for older Grab DOM builds.
                      const optionName = cells[0]?.textContent?.trim() || '';
                      const lines = optionName.split('\n').map(l => l.trim()).filter(l => l);
                      if (lines.length >= 2) {
                        data.orderItems[currentItemIndex].modifiers.push({
                          name: lines[0],
                          value: lines[1]
                        });
                      }
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
          tax: detailedData.pricing.tax || 0,
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

  async extractOrdersForStateUpdate() {
    try {
      logger.order('Starting state-only extraction from History tab...');

      if (!this.page || this.page.isClosed()) {
        throw new Error('Page not available for state extraction');
      }

      try {
        await this.page.waitForSelector('.history-table-list, .dui-table-body', { timeout: 10000 });
      } catch (e) {
        logger.order('Table selector not found, checking page state...');
        const pageState = await this.page.evaluate(() => ({
          url: window.location.href,
          hasHistoryTable: !!document.querySelector('.history-table-list'),
          hasTableBody: !!document.querySelector('.dui-table-body'),
        }));
        logger.order(`Page state: hasTable=${pageState.hasHistoryTable || pageState.hasTableBody}, url=${pageState.url}`);
        if (!pageState.hasHistoryTable && !pageState.hasTableBody) {
          return [];
        }
      }

      await sleep(2000);

      const rows = await this.page.evaluate(() => {
        const tableWrapper = document.querySelector('.history-table-list');
        if (!tableWrapper) return [];

        const allRows = tableWrapper.querySelectorAll('.dui-table-body tbody tr');
        return Array.from(allRows).filter(row => {
          if (row.getAttribute('aria-hidden') === 'true') return false;
          if (row.classList.contains('dui-table-measure-row')) return false;
          if (row.offsetHeight === 0) return false;
          return true;
        }).length;
      });

      logger.order(`Found ${rows} order rows in history table for state update`);

      if (rows === 0) {
        return [];
      }

      const results = [];

      for (let i = 0; i < rows; i++) {
        try {
          if (!this.page || this.page.isClosed()) {
            logger.order('Page is closed, returning current results');
            break;
          }

          const rowData = await this.page.evaluate((index) => {
            const tableWrapper = document.querySelector('.history-table-list');
            if (!tableWrapper) return null;

            const allRows = tableWrapper.querySelectorAll('.dui-table-body tbody tr');
            const visibleRows = Array.from(allRows).filter(row => {
              if (row.getAttribute('aria-hidden') === 'true') return false;
              if (row.classList.contains('dui-table-measure-row')) return false;
              if (row.offsetHeight === 0) return false;
              return true;
            });

            const row = visibleRows[index];
            if (!row) return null;

            const cells = row.querySelectorAll('.dui-table-cell');
            // Status is read from cells[4]; reject rows too short to supply it.
            if (cells.length < 5) return null;

            const longOrderId = cells[1]?.textContent?.trim() || '';
            const shortOrderId = cells[2]?.textContent?.trim() || '';

            const statusText = cells[4]?.textContent?.trim() || '';
            let status = 'unknown';
            const statusLower = statusText.toLowerCase();
            if (statusLower.includes('complet')) status = 'completed';
            else if (statusLower.includes('cancel')) status = 'cancelled';
            else if (statusLower.includes('process')) status = 'processing';
            else if (statusLower.includes('prepar')) status = 'preparing';
            else if (statusLower.includes('deliver')) status = 'delivered';
            else if (statusLower.includes('pending')) status = 'pending';
            else if (statusText && !/^\d/.test(statusText)) status = statusText;

            return { longOrderId, shortOrderId, status };
          }, i);

          if (!rowData) {
            logger.order(`Could not extract row data for index ${i}`);
            continue;
          }

          const drawerOpened = await this.clickOrderRowAndWait(i);

          let driverStatus = '';
          let orderTimestamp = null;

          if (drawerOpened) {
            await sleep(1000);
            const drawerData = await this.page.evaluate(() => {
              const driverStateEl = document.querySelector('[data-testid="driverState"]');
              // Timestamp lives in the Driver card. Preferred anchor is structural —
              // it is the next non-empty sibling of driverState inside the same
              // .dui-col. Never key this on a hashed CSS-module class alone: those
              // change on every Grab deploy, and when they do the state sync
              // silently stops dating orders (observed live on 27 Sep 2026, when
              // css-e4jgmp-DriverDisplay became css-ot2nvz).
              const driverCard = Array.from(document.querySelectorAll('.dui-card-head-title'))
                .find(t => t.textContent.trim() === 'Driver');
              const body = driverCard?.closest('.dui-card')?.querySelector('.dui-card-body');

              let timestampText = '';

              if (driverStateEl?.parentElement) {
                for (const sib of driverStateEl.parentElement.children) {
                  if (sib !== driverStateEl && sib.textContent.trim()) {
                    timestampText = sib.textContent.trim();
                    break;
                  }
                }
              }

              // Fallback: scan the Driver card text for the portal's timestamp shape
              // ("27 Sep, Sun, 12:26 PM"), so this survives a further class rename.
              if (!timestampText && body) {
                const m = body.innerText.match(/\d{1,2}\s+[A-Za-z]{3},\s*[A-Za-z]+,?\s*\d{1,2}:\d{2}\s*(AM|PM)/i);
                if (m) timestampText = m[0];
              }

              return {
                driverStatus: driverStateEl ? driverStateEl.textContent.trim() : '',
                timestampText
              };
            });
            driverStatus = drawerData.driverStatus;
            if (drawerData.timestampText) {
              orderTimestamp = parseGrabTimestamp(drawerData.timestampText);
            }
            await this.closeOrderDrawer();
            await sleep(500);
          } else {
            logger.order(`Drawer did not open for order ${rowData.shortOrderId}`);
          }

          results.push({
            orderNumber: rowData.shortOrderId,
            longOrderId: rowData.longOrderId,
            status: rowData.status,
            driverStatus,
            orderTimestamp,
          });

          await sleep(300);

        } catch (error) {
          if (error.message && error.message.includes('detached')) {
            logger.order(`Frame detached during state extraction, returning current results`);
            break;
          }
          logger.error(`Failed to extract state for row ${i}:`, error.message);
          try {
            await this.closeOrderDrawer();
          } catch (e) {}
          await sleep(500);
        }
      }

      logger.order(`Extracted state for ${results.length} orders`);
      return results;
    } catch (error) {
      logger.error('Failed to extract orders for state update:', error);
      throw error;
    }
  }

  filterNewOrders(orders) {
    if (!this.lastPollTime) {
      logger.order('First poll - fetching all historical orders');
      this.lastPollTime = new Date(Date.now() - (365 * 24 * 60 * 60 * 1000));
    }

    // The extractor is now reused across poll cycles, so the in-memory dedup set
    // accumulates. Cap it, or it grows without bound and eventually suppresses
    // legitimate re-reads of a reused order number on a later date.
    if (this.processedOrderIds.size > 500) {
      this.processedOrderIds.clear();
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

  setPage(page) {
    if (this.page === page) return;
    this.page = page;
    // A new page means a new DOM context: the dedup set and poll watermark refer
    // to the previous document and must not leak across.
    this.processedOrderIds.clear();
    this.lastPollTime = null;
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
