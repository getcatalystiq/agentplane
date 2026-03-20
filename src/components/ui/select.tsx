import * as React from "react";

export function Select({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative w-full">
      <select
        className={`flex h-9 w-full appearance-none rounded-md border border-input bg-transparent pl-3 pr-8 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ${className}`}
        {...props}
      />
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        <svg className="h-3.5 w-3.5 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 15 5 5 5-5"/>
          <path d="m7 9 5-5 5 5"/>
        </svg>
      </div>
    </div>
  );
}
