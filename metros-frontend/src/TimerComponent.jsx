import { useState, useEffect, useRef } from 'react';
import bridge from '@vkontakte/vk-bridge';
import { helpers } from './services/api';
export const TimerComponent = ({ 
  selectedMinutes, 
  onTimerSelect, 
  userId,
  onStatusUpdate 
}) => {
  console.log('🎯 TimerComponent загружен!', { selectedMinutes, userId });

  const testClick = () => {
    console.log('✅ Тестовая кнопка работает!');
  };

  // 🔧 ДИАГНОСТИКА - добавьте этот console.log
  console.log('🔧 TimerComponent рендерится:', { 
    selectedMinutes, 
    userId,
    hasOnTimerSelect: !!onTimerSelect,
    hasOnStatusUpdate: !!onStatusUpdate
  });
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  
  const timerIntervalRef = useRef(null);

  // Сброс таймера при изменении минут
  useEffect(() => {
    if (!timerActive) {
      setTimeLeft(selectedMinutes * 60);
    }
  }, [selectedMinutes, timerActive]);

  const startTimer = async () => {
    console.log('🟢 startTimer вызван, минут:', selectedMinutes);
    
    if (timerIntervalRef.current) {
      console.log('⏹️ Таймер уже запущен');
      return;
    }
    
    const initialSeconds = selectedMinutes * 60;
    setTimeLeft(initialSeconds);
    setTimerActive(true);
    
    // Обновляем статус пользователя
    if (userId && onStatusUpdate) {
      try {
        await onStatusUpdate({
          show_timer: true,
          timer_seconds: initialSeconds,
          status: `Таймер запущен: ${selectedMinutes} мин`
        });
      } catch (error) {
        console.error('Ошибка обновления статуса:', error);
      }
    }
    
    timerIntervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        const newTime = prev - 1;
        
        // Обновляем статус каждые 30 секунд
        if (userId && onStatusUpdate && newTime % 30 === 0) {
          onStatusUpdate({
            timer_seconds: newTime,
            status: `Таймер: ${helpers.formatTime(newTime)}`
          }).catch(console.error);
        }
        
        if (newTime <= 0) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
          setTimerActive(false);
          
          bridge.send("VKWebAppShowSnackbar", {
            text: 'Время ожидания истекло!'
          });
          
          if (userId && onStatusUpdate) {
            onStatusUpdate({
              show_timer: false,
              timer_seconds: 0,
              status: 'Время ожидания истекло'
            }).catch(console.error);
          }
          
          return 0;
        }
        
        return newTime;
      });
    }, 1000);
    
    console.log('✅ Таймер запущен');
  };

  const stopTimer = async () => {
    console.log('🔴 stopTimer вызван');
    
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    setTimerActive(false);
    setTimeLeft(selectedMinutes * 60);
    
    // Обновляем статус пользователя
    if (userId && onStatusUpdate) {
      try {
        await onStatusUpdate({
          show_timer: false,
          timer_seconds: 0,
          status: 'Таймер остановлен'
        });
      } catch (error) {
        console.error('Ошибка обновления статуса:', error);
      }
    }
    
    console.log('✅ Таймер остановлен');
  };

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  return (
    <div className="compact-timer" id="waiting-room-timer">
        {/* Добавьте тестовую кнопку */}
      <button 
        onClick={testClick}
        style={{
          background: 'red',
          color: 'white', 
          padding: '10px',
          margin: '10px 0'
        }}
      >
        ТЕСТ: Нажми меня и посмотри в консоль
      </button>
      <div className="timer-header">
        <div className="timer-title">⏰ Таймер ожидания</div>
        <div className="timer-status">
          {timerActive ? 'Активен' : 'Не активен'}
        </div>
      </div>
      <div className="timer-expanded active">
        <p>Выберите время ожидания на станции</p>
        <div className="timer-options">
          <button 
            type="button" 
            className={`btn timer-option ${selectedMinutes === 5 ? 'active' : ''}`}
            onClick={() => onTimerSelect(5)}
          >
            5 минут
          </button>
          <button 
            type="button" 
            className={`btn timer-option ${selectedMinutes === 10 ? 'active' : ''}`}
            onClick={() => onTimerSelect(10)}
          >
            10 минут
          </button>
          <button 
            type="button" 
            className={`btn timer-option ${selectedMinutes === 15 ? 'active' : ''}`}
            onClick={() => onTimerSelect(15)}
          >
            15 минут
          </button>
        </div>
        <div className="timer-display">
          {timerActive 
            ? `Осталось: ${helpers.formatTime(timeLeft)}` 
            : `Готов к запуску: ${selectedMinutes} мин`
          }
        </div>
        <div className="timer-controls">
          <button 
            type="button" 
            className="btn btn-success" 
            onClick={startTimer}
            disabled={timerActive}
          >
            Запустить таймер
          </button>
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={stopTimer}
            disabled={!timerActive}
          >
            Остановить
          </button>
        </div>
      </div>
    </div>
  );
};