const router = require('express').Router();
const { getUser, updateUser, followUser, checkFollow, getFollowingRooms } = require('../controllers/userController');
const auth = require('../middleware/auth');

router.get('/following-rooms', auth, getFollowingRooms);
router.get('/:id', getUser);
router.put('/me', auth, updateUser);
router.post('/:id/follow', auth, followUser);
router.get('/:id/follow', auth, checkFollow);

module.exports = router;
