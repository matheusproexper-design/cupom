import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({ label, icon, className, ...props }) => {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-400 transition-colors">
          {icon}
        </div>
        <input
          className={`w-full bg-gray-800 border-2 border-gray-600 hover:border-gray-500 focus:border-blue-500 text-gray-100 text-sm rounded-lg focus:ring-2 focus:ring-blue-500/20 block w-full pl-10 p-3 placeholder-gray-400 transition-all duration-200 uppercase ${className}`}
          placeholder={label.toUpperCase()}
          {...props}
        />
      </div>
    </div>
  );
};

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: string[];
  icon?: React.ReactNode;
}

export const Select: React.FC<SelectProps> = ({ label, icon, options, className, ...props }) => {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="relative group">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-400 transition-colors">
          {icon}
        </div>
        <select
          className={`w-full bg-gray-800 border-2 border-gray-600 hover:border-gray-500 focus:border-blue-500 text-gray-100 text-sm rounded-lg focus:ring-2 focus:ring-blue-500/20 block w-full pl-10 p-3 placeholder-gray-400 transition-all duration-200 uppercase appearance-none cursor-pointer ${className}`}
          {...props}
        >
          <option value="" disabled className="text-gray-500">{label.toUpperCase()}</option>
          {options.map((opt) => (
            <option key={opt} value={opt} className="uppercase">{opt}</option>
          ))}
        </select>
        {/* Custom arrow for styling consistency */}
        <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
        </div>
      </div>
    </div>
  );
};

export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }> = ({ label, className, ...props }) => {
  return (
    <div className="flex flex-col gap-1 w-full">
      <textarea
        className={`w-full bg-gray-800 border-2 border-gray-600 hover:border-gray-500 focus:border-blue-500 text-gray-100 text-sm rounded-lg focus:ring-2 focus:ring-blue-500/20 block w-full p-3 placeholder-gray-400 transition-all duration-200 uppercase min-h-[100px] resize-none ${className}`}
        placeholder={label.toUpperCase()}
        {...props}
      />
    </div>
  );
};