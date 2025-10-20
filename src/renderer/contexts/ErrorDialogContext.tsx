import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ErrorDialog, ErrorDialogProps } from '../components/common/ErrorDialog';

interface ErrorDialogContextValue {
  showError: (props: Omit<ErrorDialogProps, 'onClose'>) => void;
}

const ErrorDialogContext = createContext<ErrorDialogContextValue | null>(null);

export function useErrorDialog() {
  const context = useContext(ErrorDialogContext);
  if (!context) {
    throw new Error('useErrorDialog must be used within ErrorDialogProvider');
  }
  return context;
}

interface ErrorDialogProviderProps {
  children: ReactNode;
}

export function ErrorDialogProvider({ children }: ErrorDialogProviderProps) {
  const [errorData, setErrorData] = useState<Omit<ErrorDialogProps, 'onClose'> | null>(null);
  
  useEffect(() => {
    // IPC로부터 에러 다이얼로그 표시 요청 수신
    const unsubscribe = window.electronAPI.onShowErrorDialog?.((data: any) => {
      setErrorData(data);
    });
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);
  
  const showError = (props: Omit<ErrorDialogProps, 'onClose'>) => {
    setErrorData(props);
  };
  
  const handleClose = () => {
    setErrorData(null);
  };
  
  return (
    <ErrorDialogContext.Provider value={{ showError }}>
      {children}
      {errorData && (
        <ErrorDialog
          {...errorData}
          onClose={handleClose}
        />
      )}
    </ErrorDialogContext.Provider>
  );
}
