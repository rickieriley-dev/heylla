const router = require('express').Router();
const { getRooms, createRoom, getRoom, getMyRoom, deleteRoom } = require('../controllers/roomController');
const auth = require('../middleware/auth');

router.get('/', getRooms);
router.post('/', auth, createRoom);
router.get('/mine', auth, getMyRoom);  // must be before /:id
router.get('/:id', getRoom);
router.delete('/:id', auth, deleteRoom);

module.exports = router;
