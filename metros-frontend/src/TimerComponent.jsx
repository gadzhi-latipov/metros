import { useState, useEffect } from 'react';

export const TimerComponent = ({ 
  selectedMinutes, 
  onTimerSelect, 
  userId, 
  onStatusUpdate 
}) => {
  const [timeLeft, setTimeLeft] = useState(selectedMinutes * 60);
  const [isActive, setIsActive] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false); // Новое состояние для свертывания/раскрытия

  useEffect(() => {
    let interval = null;
    
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(timeLeft => timeLeft - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      setIsActive(false);
      // Оповещаем о завершении таймера
      if (onStatusUpdate) {
        onStatusUpdate({
          show_timer: false,
          timer_seconds: 0,
          status: 'Таймер завершен'
        });
      }
    }
    
    return () => clearInterval(interval);
  }, [isActive, timeLeft, onStatusUpdate]);

  const startTimer = () => {
    if (selectedMinutes > 0) {
      setIsActive(true);
      setTimeLeft(selectedMinutes * 60);
      
      if (onStatusUpdate) {
        onStatusUpdate({
          show_timer: true,
          timer_seconds: selectedMinutes * 60,
          status: `Таймер установлен: ${selectedMinutes} мин`
        });
      }
    }
  };

  const stopTimer = () => {
    setIsActive(false);
    if (onStatusUpdate) {
      onStatusUpdate({
        show_timer: false,
        timer_seconds: 0
      });
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="timer-component">
      {/* Заголовок-кнопка для раскрытия/сворачивания */}
      <div 
        className="timer-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h4>⏰ Таймер присутствия {isExpanded ? '▲' : '▼'}</h4>
      </div>

      {/* Содержимое таймера */}
      {isExpanded && (
        <div className="timer-content">
          <div className="timer-options">
            <label>Установить таймер на:</label>
            <div className="timer-buttons">
              {[5, 10, 15, 20, 30].map(minutes => (
                <button
                  key={minutes}
                  className={`timer-btn ${selectedMinutes === minutes ? 'active' : ''}`}
                  onClick={() => onTimerSelect(minutes)}
                  disabled={isActive}
                >
                  {minutes} мин
                </button>
              ))}
            </div>
          </div>

          <div className="timer-display">
            {isActive ? (
              <>
                <div className="timer-time">{formatTime(timeLeft)}</div>
                <button className="btn btn-danger" onClick={stopTimer}>
                  Остановить таймер
                </button>
              </>
            ) : (
              <button 
                className="btn btn-success" 
                onClick={startTimer}
                disabled={selectedMinutes === 0}
              >
                Запустить таймер на {selectedMinutes} мин
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};