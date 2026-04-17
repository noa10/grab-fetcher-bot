const mongoose = require('mongoose');
const Order = require('./Order');

const CHAMPION_MONETARY_THRESHOLD = Number(process.env.RFM_CHAMPION_MONETARY_THRESHOLD) || 300;

const customerSchema = new mongoose.Schema({
  customerKey: {
    type: String,
    required: true,
    index: { unique: true, sparse: true },
    trim: true
  },
  name: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  firstOrder: {
    type: Date
  },
  lastOrder: {
    type: Date
  },
  frequency: {
    type: Number
  },
  monetary: {
    type: Number
  },
  recencyDays: {
    type: Number
  },
  avgOrderValue: {
    type: Number
  },
  segment: {
    type: String
  }
}, {
  timestamps: true,
  collection: 'customers'
});

customerSchema.statics.buildCustomerCollection = async function () {
  await this.deleteMany({ $or: [{ customerKey: null }, { customerKey: '' }] });

  try {
    const indexes = await this.collection.indexes();
    const ckIndex = indexes.find(i => i.key && i.key.customerKey === 1 && !i.sparse);
    if (ckIndex) {
      await this.collection.dropIndex(ckIndex.name);
    }
    await this.collection.createIndex({ customerKey: 1 }, { unique: true, sparse: true });
  } catch (_) {}

  return Order.aggregate([
    {
      $addFields: {
        customerKey: {
          $ifNull: [
            { $cond: [{ $eq: ['$customerPhone', ''] }, null, '$customerPhone'] },
            {
              $ifNull: [
                { $cond: [{ $eq: ['$customerName', ''] }, null, '$customerName'] },
                { $concat: ['order:', '$orderNumber'] }
              ]
            }
          ]
        }
      }
    },
    {
      $group: {
        _id: '$customerKey',
        name: { $first: '$customerName' },
        phone: { $first: '$customerPhone' },
        firstOrder: { $min: '$orderTimestamp' },
        lastOrder: { $max: '$orderTimestamp' },
        frequency: { $sum: 1 },
        monetary: { $sum: '$pricing.total' },
        avgOrderValue: { $avg: '$pricing.total' }
      }
    },
    {
      $addFields: {
        recencyDays: {
          $dateDiff: { startDate: '$lastOrder', endDate: '$$NOW', unit: 'day' }
        },
        segment: {
          $cond: [
            {
              $and: [
                { $lte: [{ $dateDiff: { startDate: '$lastOrder', endDate: '$$NOW', unit: 'day' } }, 7] },
                { $gte: ['$frequency', 5] },
                { $gte: ['$monetary', CHAMPION_MONETARY_THRESHOLD] }
              ]
            },
            'Champions',
            {
              $cond: [
                {
                  $and: [
                    { $lte: [{ $dateDiff: { startDate: '$lastOrder', endDate: '$$NOW', unit: 'day' } }, 14] },
                    { $gte: ['$frequency', 3] }
                  ]
                },
                'Loyal',
                {
                  $cond: [
                    {
                      $and: [
                        { $lte: [{ $dateDiff: { startDate: '$lastOrder', endDate: '$$NOW', unit: 'day' } }, 30] },
                        { $gte: ['$frequency', 1] }
                      ]
                    },
                    'Potential Loyalist',
                    {
                      $cond: [
                        {
                          $and: [
                            { $gte: [{ $dateDiff: { startDate: '$lastOrder', endDate: '$$NOW', unit: 'day' } }, 31] },
                            { $lte: [{ $dateDiff: { startDate: '$lastOrder', endDate: '$$NOW', unit: 'day' } }, 90] }
                          ]
                        },
                        'At-Risk',
                        {
                          $cond: [
                            { $gt: [{ $dateDiff: { startDate: '$lastOrder', endDate: '$$NOW', unit: 'day' } }, 90] },
                            'Lost',
                            'Other'
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      $project: {
        _id: 0,
        customerKey: '$_id',
        name: 1,
        phone: 1,
        firstOrder: 1,
        lastOrder: 1,
        frequency: 1,
        monetary: 1,
        avgOrderValue: 1,
        recencyDays: 1,
        segment: 1
      }
    },
    {
      $merge: {
        into: 'customers',
        on: 'customerKey',
        whenMatched: 'replace',
        whenNotMatched: 'insert'
      }
    }
  ]);
};

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;
