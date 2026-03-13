const router = require('express').Router();
const { getRooms, createRoom, getRoom } = require('../controllers/roomController');
const auth = require('../middleware/auth');

router.get('/', getRooms);
router.post('/', auth, createRoom);
router.get('/:id', getRoom);

module.exports = router;
