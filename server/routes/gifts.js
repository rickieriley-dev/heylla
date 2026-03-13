const router = require('express').Router();
const { getGifts, sendGift } = require('../controllers/giftController');
const auth = require('../middleware/auth');
 
router.get('/', getGifts);
router.post('/send', auth, sendGift);
 
module.exports = router;
 
