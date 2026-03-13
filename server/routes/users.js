const router = require('express').Router();
const { getUser, updateUser } = require('../controllers/userController');
const auth = require('../middleware/auth');
 
router.get('/:id', getUser);
router.put('/me', auth, updateUser);
 
module.exports = router;
 
