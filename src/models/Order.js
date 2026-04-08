const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  // Core order information
  orderNumber: {
    type: String,
    required: true,
    index: true,
    trim: true
  },

  // Date portion of orderTimestamp for dedup (Grab reuses order numbers across dates)
  orderDate: {
    type: Date,
    required: true,
    index: true
  },

  longOrderId: {
    type: String,
    trim: true,
    default: ''
  },

  bookingId: {
    type: String,
    trim: true,
    default: ''
  },

  customerName: {
    type: String,
    required: true,
    trim: true
  },

  customerPhone: {
    type: String,
    trim: true,
    default: ''
  },

  customerNote: {
    type: String,
    trim: true,
    default: ''
  },

  driverName: {
    type: String,
    default: 'Pending',
    trim: true
  },

  driverPhone: {
    type: String,
    trim: true,
    default: ''
  },

  driverStatus: {
    type: String,
    trim: true,
    default: ''
  },

  driverPhotoUrl: {
    type: String,
    trim: true,
    default: ''
  },

  deliveryTime: {
    type: String,
    trim: true,
    default: ''
  },

  // Order details
  orderDetails: {
    items: [{
      name: String,
      quantity: Number,
      price: Number,
      notes: String,
      total: Number
    }],
    specialInstructions: String,
    restaurantName: String,
    orderType: {
      type: String,
      enum: ['delivery', 'pickup', 'dine-in'],
      default: 'delivery'
    }
  },

  // Pricing information
  pricing: {
    subtotal: {
      type: Number,
      required: true,
      min: 0
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: 0
    },
    serviceFee: {
      type: Number,
      default: 0,
      min: 0
    },
    tax: {
      type: Number,
      default: 0,
      min: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    discountCode: {
      type: String,
      default: ''
    },
    total: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'MYR'
    }
  },
  
  // Delivery information
  deliveryInfo: {
    address: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    estimatedDeliveryTime: Date,
    actualDeliveryTime: Date
  },
  
  // Order status and timing
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled', 'completed', 'unknown'],
    default: 'pending'
  },
  
  orderTimestamp: {
    type: Date,
    required: true,
    index: true
  },
  
  // Screenshot and metadata
  screenshotPath: {
    type: String,
    default: null
  },
  
  screenshotUrl: {
    type: String,
    default: null
  },
  
  // Tracking and metadata
  fetchedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  
  source: {
    type: String,
    default: 'grab-merchant-portal'
  },
  
  // Raw data for debugging
  rawData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Processing flags
  isProcessed: {
    type: Boolean,
    default: false
  },
  
  hasErrors: {
    type: Boolean,
    default: false
  },
  
  errorMessages: [{
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  collection: 'orders'
});

// Indexes for better query performance
orderSchema.index({ orderTimestamp: -1 });
orderSchema.index({ fetchedAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'pricing.total': -1 });
orderSchema.index({ createdAt: -1 });

// Compound unique index: Grab reuses order numbers across dates
orderSchema.index({ orderNumber: 1, orderDate: 1 }, { unique: true });

// Virtual for order age
orderSchema.virtual('orderAge').get(function() {
  return Date.now() - this.orderTimestamp.getTime();
});

// Virtual for processing time
orderSchema.virtual('processingTime').get(function() {
  return this.fetchedAt.getTime() - this.orderTimestamp.getTime();
});

// Pre-save middleware to update lastUpdated
orderSchema.pre('save', async function() {
  this.lastUpdated = new Date();
});

// Helper: get date-only (midnight UTC) from a timestamp
orderSchema.statics.toOrderDate = function(timestamp) {
  const d = timestamp instanceof Date ? new Date(timestamp) : new Date(timestamp || Date.now());
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// Static methods
orderSchema.statics.findByOrderNumber = function(orderNumber) {
  return this.findOne({ orderNumber: orderNumber });
};

// Find order by orderNumber + orderDate (for dedup with reused order numbers)
orderSchema.statics.findByOrderNumberAndDate = function(orderNumber, orderTimestamp) {
  const orderDate = this.toOrderDate(orderTimestamp);
  return this.findOne({ orderNumber, orderDate });
};

orderSchema.statics.findRecentOrders = function(hours = 24) {
  const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
  return this.find({ orderTimestamp: { $gte: cutoff } })
    .sort({ orderTimestamp: -1 });
};

orderSchema.statics.findOrdersByDateRange = function(startDate, endDate) {
  return this.find({
    orderTimestamp: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ orderTimestamp: -1 });
};

orderSchema.statics.getOrderStats = function(days = 7) {
  const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  
  return this.aggregate([
    { $match: { orderTimestamp: { $gte: cutoff } } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$pricing.total' },
        avgOrderValue: { $avg: '$pricing.total' },
        maxOrderValue: { $max: '$pricing.total' },
        minOrderValue: { $min: '$pricing.total' }
      }
    }
  ]);
};

// Instance methods
orderSchema.methods.markAsProcessed = function() {
  this.isProcessed = true;
  this.lastUpdated = new Date();
  return this.save();
};

orderSchema.methods.addError = function(errorMessage) {
  this.hasErrors = true;
  this.errorMessages.push({
    message: errorMessage,
    timestamp: new Date()
  });
  this.lastUpdated = new Date();
  return this.save();
};

orderSchema.methods.toExportFormat = function() {
  return {
    orderNumber: this.orderNumber,
    longOrderId: this.longOrderId,
    bookingId: this.bookingId,
    customerName: this.customerName,
    customerPhone: this.customerPhone,
    customerNote: this.customerNote,
    driverName: this.driverName,
    driverPhone: this.driverPhone,
    driverStatus: this.driverStatus,
    driverPhotoUrl: this.driverPhotoUrl,
    deliveryTime: this.deliveryTime,
    restaurantName: this.orderDetails.restaurantName,
    orderType: this.orderDetails.orderType,
    items: this.orderDetails.items,
    status: this.status,
    subtotal: this.pricing.subtotal,
    deliveryFee: this.pricing.deliveryFee,
    discount: this.pricing.discount,
    discountCode: this.pricing.discountCode,
    total: this.pricing.total,
    currency: this.pricing.currency,
    orderTimestamp: this.orderTimestamp,
    deliveryAddress: this.deliveryInfo.address,
    estimatedDeliveryTime: this.deliveryInfo.estimatedDeliveryTime,
    actualDeliveryTime: this.deliveryInfo.actualDeliveryTime,
    fetchedAt: this.fetchedAt
  };
};

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
