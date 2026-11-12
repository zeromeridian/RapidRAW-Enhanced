import { useEffect, useRef, useState } from 'react';

/** Keeps a dragged order (framer-motion `Reorder`) locally and commits it once the drag ends. */
export function useReorderableList(savedOrder: string[], onCommit: (order: string[]) => void) {
  const [order, setOrder] = useState(savedOrder);
  const orderRef = useRef(savedOrder);

  useEffect(() => {
    setOrder(savedOrder);
    orderRef.current = savedOrder;
  }, [savedOrder]);

  const handleReorder = (newOrder: string[]) => {
    orderRef.current = newOrder;
    setOrder(newOrder);
  };

  const handleDragEnd = () => {
    if (orderRef.current.join() !== savedOrder.join()) {
      onCommit(orderRef.current);
    }
  };

  return { handleDragEnd, handleReorder, order };
}
