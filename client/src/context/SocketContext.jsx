import { createContext, useContext, useEffect, useState } from 'react';
import { connectSocket, disconnectSocket } from '../utils/socket';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (user && token) {
      const s = connectSocket(token);
      setSocket(s);
      return () => { disconnectSocket(); setSocket(null); };
    }
  }, [user]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};

export const useSocket = () => useContext(SocketContext);
