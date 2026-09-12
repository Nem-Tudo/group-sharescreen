"use client";
import type { ReactNode } from 'react';


export default function SupressErrors({ children }: { children: ReactNode }) {
    if (typeof window !== 'undefined') {
        const originalError = console.error;
        console.error = (...args) => {
            const message = args.join(' ');
            if (message.includes("Accessing element.ref was removed in React 19")) {
                console.log(`Supressed error: ${message}`)
                return; // ignora o erro
            }
            originalError(...args);
        };
    }
    return children
}