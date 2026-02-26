import { useState, useLayoutEffect, useCallback } from 'react';

export function useMeasure<T extends HTMLElement>() {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [node, setNode] = useState<T | null>(null);

    const ref = useCallback((node: T | null) => {
        setNode(node);
    }, []);

    useLayoutEffect(() => {
        if (!node) return;

        const measure = () => {
            const rect = node.getBoundingClientRect();
            if (rect.width !== dimensions.width || rect.height !== dimensions.height) {
                setDimensions({ width: rect.width, height: rect.height });
            }
        };

        measure();

        const observer = new ResizeObserver(() => {
            measure();
        });

        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, [node, dimensions.width, dimensions.height]);

    return [ref, dimensions] as const;
}
