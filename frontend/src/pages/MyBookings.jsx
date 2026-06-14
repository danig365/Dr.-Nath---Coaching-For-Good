// pages/MyBookings.jsx
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiCalendar, FiClock, FiUser } from 'react-icons/fi';
import axios from '../utils/axios';

const serif = "'Playfair Display', serif";

const MyBookings = () => {
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const res = await axios.get('/bookings/my/');
        setBookings(res.data);
      } catch (err) {
        console.error('Error fetching bookings', err);
      }
    };
    fetchBookings();
  }, []);

  return (
    <div className="min-h-screen pt-28 pb-16 px-6" style={{ background: '#FAF6EC' }}>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-normal mb-8" style={{ color: '#1B2B4A', fontFamily: serif }}>
          My Booked Sessions
        </h1>

        {bookings.length === 0 ? (
          <div
            className="text-center py-20 rounded-2xl"
            style={{ background: 'white', border: '1px solid rgba(27,43,74,0.1)' }}
          >
            <p className="text-5xl mb-4">📅</p>
            <p className="text-sm" style={{ color: '#4A5568' }}>No sessions booked yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((booking, i) => (
              <motion.div
                key={booking.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="rounded-2xl p-6 bg-white"
                style={{ border: '1px solid rgba(200,169,81,0.15)', boxShadow: '0 2px 16px rgba(27,43,74,0.05)' }}
              >
                <h2 className="text-xl font-normal mb-3" style={{ color: '#1B2B4A', fontFamily: serif }}>
                  {booking.skill.title}
                </h2>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: '#4A5568' }}>
                  <span className="flex items-center gap-2">
                    <FiUser size={13} style={{ color: '#C8A951' }} /> {booking.skill.mentor}
                  </span>
                  <span className="flex items-center gap-2">
                    <FiCalendar size={13} style={{ color: '#C8A951' }} /> {booking.session_date}
                  </span>
                  <span className="flex items-center gap-2">
                    <FiClock size={13} style={{ color: '#C8A951' }} /> {booking.session_time}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyBookings;
