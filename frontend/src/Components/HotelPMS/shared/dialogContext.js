import { createContext, useContext } from 'react';

export const DialogContext = createContext({ id: null, depth: 0 });
export const useDialogOwner = () => useContext(DialogContext).id;
