const Room = require('../models/Room');
const Seat = require('../models/Seat');

exports.getRooms = async (req, res, next) => {
  try {
    const rooms = await Room.findAll();
    res.json(rooms);
  } catch (err) { next(err); }
};

exports.createRoom = async (req, res, next) => {
  try {
    const { name, tag, description, is_locked } = req.body;
    const room = await Room.create({ name, host_id: req.user.id, tag, description, is_locked });
    await Seat.initSeats(room.id, 10);
    res.status(201).json(room);
  } catch (err) { next(err); }
};

exports.getRoom = async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const seats = await Seat.getSeats(room.id);
    res.json({ ...room, seats });
  } catch (err) { next(err); }
};
