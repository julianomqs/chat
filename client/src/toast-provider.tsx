import { Toast } from "primereact/toast";
import { ReactNode, RefObject, createContext, useContext, useRef } from "react";

const ToastContext = createContext<RefObject<Toast | null>>(null!);

export const ToastProvider = ({
  children,
  ...props
}: {
  children?: ReactNode;
}) => {
  const ref = useRef<Toast>(null);

  return (
    <ToastContext.Provider value={ref} {...props}>
      <Toast ref={ref} />
      {children}
    </ToastContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext);
