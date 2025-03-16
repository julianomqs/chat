import { Toast } from "primereact/toast";
import { RefObject, createContext, useContext } from "react";

export const ToastContext = createContext<RefObject<Toast | null>>(null!);

export const useToast = () => useContext(ToastContext);
