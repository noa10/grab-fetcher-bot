// GET /api/feedback — fetched reviews, filterable and paginated.
const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { listReviews } = require('../reviews-query');

router.get('/', async (req, res) => {
  try {
    const result = await listReviews(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to list reviews:', error);
    res.status(500).json({ success: false, message: 'Failed to load reviews' });
  }
});

module.exports = router;
