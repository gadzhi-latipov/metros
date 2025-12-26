import { useState, useEffect } from 'react';
import { api } from './services/api';

export const TimerComponent = ({ 
  selectedMinutes, 
  onTimerSelect, 
  userId, 
  onStatusUpdate 
}) => {
  const [timeLeft, setTimeLeft] = useState(selectedMinutes * 60);
  const [isActive, setIsActive] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(0);

  // Обновление таймера на сервере при изменении
  const updateTimerOnServer = async (showTimer, seconds, status) => {
    if (!userId) return;
    
    try {
      await api.updateUser(userId, {
        show_timer: showTimer,
        timer_seconds: seconds,
        status: status,
        timer_started_at: showTimer ? new Date().toISOString() : null,
        last_seen: new Date().toISOString()
      });
      console.log('✅ Таймер обновлен на сервере:', seconds);
    } catch (error) {
      console.error('❌ Ошибка обновления таймера на сервере:', error);
    }
  };

  // Периодическое обновление таймера на сервере (каждые 10 секунд)
  useEffect(() => {
    if (!isActive || !userId) return;
    
    const interval = setInterval(() => {
      updateTimerOnServer(true, timeLeft, `Таймер: ${formatTime(timeLeft)}`);
    }, 10000); // Обновляем каждые 10 секунд
    
    return () => clearInterval(interval);
  }, [isActive, timeLeft, userId]);

  // Основной таймер
  useEffect(() => {
    let interval = null;
    
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prevTime => {
          const newTime = prevTime - 1;
          
          // Обновляем на сервере каждую минуту или при важных событиях
          if (newTime % 60 === 0 || newTime <= 10) {
            updateTimerOnServer(true, newTime, `Таймер: ${formatTime(newTime)}`);
          }
          
          return newTime;
        });
      }, 1000);
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false);
      // Оповещаем о завершении таймера
      if (onStatusUpdate) {
        onStatusUpdate({
          show_timer: false,
          timer_seconds: 0,
          status: 'Таймер завершен'
        });
      }
      updateTimerOnServer(false, 0, 'Таймер завершен');
    }
    
    return () => clearInterval(interval);
  }, [isActive, timeLeft, onStatusUpdate, userId]);

  const startTimer = async () => {
    if (selectedMinutes > 0 && userId) {
      setIsActive(true);
      const initialTime = selectedMinutes * 60;
      setTimeLeft(initialTime);
      
      // Обновляем на сервере сразу
      await updateTimerOnServer(true, initialTime, `Таймер установлен: ${selectedMinutes} мин`);
      
      if (onStatusUpdate) {
        onStatusUpdate({
          show_timer: true,
          timer_seconds: initialTime,
          status: `Таймер установлен: ${selectedMinutes} мин`
        });
      }
    }
  };

  const stopTimer = async () => {
    setIsActive(false);
    
    // Обновляем на сервере
    await updateTimerOnServer(false, 0, 'Таймер остановлен');
    
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
                <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                  ⚡ Другие увидят ваше время
                </div>
              </>
            ) : (
              <>
                <button 
                  className="btn btn-success" 
                  onClick={startTimer}
                  disabled={selectedMinutes === 0}
                >
                  Запустить таймер на {selectedMinutes} мин
                </button>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                  ⏱️ Другие участники увидят ваш таймер в реальном времени
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};