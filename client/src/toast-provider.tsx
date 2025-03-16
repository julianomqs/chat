import { Toast } from "primereact/toast";
import { ReactNode, useRef } from "react";
import { ToastContext } from "./use-toast";

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
