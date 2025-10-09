import React from 'react';

interface ProgressBarProps {
  current: number;
  total: number;
  message?: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  current, 
  total, 
  message,
  className = '' 
}) => {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className={`w-full ${className}`}>
      {message && (
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          {message}
        </div>
      )}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
        {current} / {total} ({percentage}%)
      </div>
    </div>
  );
};
