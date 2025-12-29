"use client";

import { useState, useEffect, useRef } from "react";
import { Folder, ChevronDown, Home, Check, FolderOpen } from "lucide-react";

interface FolderPickerProps {
  value: string;
  onChange: (path: string) => void;
}

interface FoldersData {
  folders: string[];
  homeDir: string;
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [homeDir, setHomeDir] = useState<string>("");
  const [customPath, setCustomPath] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch available folders - refetch when value changes to filter by current scope
  useEffect(() => {
    const url = value ? `/api/folders?scope=${encodeURIComponent(value)}` : "/api/folders";
    fetch(url)
      .then((res) => res.json())
      .then((data: FoldersData) => {
        setFolders(data.folders);
        setHomeDir(data.homeDir);
      })
      .catch(console.error);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const displayPath = (path: string) => {
    if (path === homeDir) return "~ (All Projects)";
    if (path.startsWith(homeDir)) return "~" + path.slice(homeDir.length);
    return path;
  };

  const handleSelect = (path: string) => {
    onChange(path);
    setIsOpen(false);
    setCustomPath("");
    setValidationError(null);
  };

  const handleBrowse = async () => {
    try {
      const res = await fetch("/api/folders", { method: "POST" });
      const data = await res.json();

      if (data.cancelled) {
        // User cancelled, do nothing
        return;
      }

      if (data.path) {
        handleSelect(data.path);
      }
    } catch (error) {
      console.error("Failed to open folder picker:", error);
    }
  };

  const handleCustomSubmit = async () => {
    if (!customPath.trim()) return;

    setIsValidating(true);
    setValidationError(null);

    try {
      // Expand ~ to home directory
      let pathToValidate = customPath.trim();
      if (pathToValidate.startsWith("~/")) {
        pathToValidate = homeDir + pathToValidate.slice(1);
      } else if (pathToValidate === "~") {
        pathToValidate = homeDir;
      }

      const res = await fetch(`/api/folders?validate=${encodeURIComponent(pathToValidate)}`);
      const data = await res.json();

      if (data.valid) {
        handleSelect(pathToValidate);
      } else {
        setValidationError("Invalid path or not a directory");
      }
    } catch {
      setValidationError("Failed to validate path");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm text-zinc-300 transition-colors"
      >
        <Folder className="w-3.5 h-3.5 text-zinc-400" />
        <span className="font-mono max-w-[300px] truncate">{displayPath(value)}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-[400px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Path Input with Browse */}
          <div className="p-2 border-b border-zinc-800">
            <div className="flex gap-2">
              <button
                onClick={handleBrowse}
                className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
                title="Browse folders"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
              <input
                ref={inputRef}
                type="text"
                value={customPath}
                onChange={(e) => {
                  setCustomPath(e.target.value);
                  setValidationError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit();
                  if (e.key === "Escape") setIsOpen(false);
                }}
                placeholder="Type path (e.g., ~/Work/Code)"
                className="flex-1 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={isValidating || !customPath.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded transition-colors"
              >
                {isValidating ? "..." : "Go"}
              </button>
            </div>
            {validationError && (
              <p className="mt-1 text-xs text-red-400">{validationError}</p>
            )}
          </div>

          {/* Folder List */}
          <div className="max-h-[300px] overflow-y-auto">
            {/* Home Directory Option */}
            <button
              onClick={() => handleSelect(homeDir)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 transition-colors ${
                value === homeDir ? "bg-zinc-800 text-blue-400" : "text-zinc-300"
              }`}
            >
              <Home className="w-4 h-4 text-zinc-500" />
              <span className="flex-1">~ (All Projects)</span>
              {value === homeDir && <Check className="w-4 h-4" />}
            </button>

            {/* Divider */}
            <div className="border-t border-zinc-800 my-1" />

            {/* Child Project Folders */}
            <div className="px-2 py-1">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">Subfolders with Sessions</span>
            </div>
            {folders.length === 0 ? (
              <p className="px-3 py-2 text-sm text-zinc-500">No subfolders with sessions</p>
            ) : (
              folders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => handleSelect(folder)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 transition-colors ${
                    value === folder ? "bg-zinc-800 text-blue-400" : "text-zinc-300"
                  }`}
                >
                  <Folder className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <span className="flex-1 font-mono truncate">{displayPath(folder)}</span>
                  {value === folder && <Check className="w-4 h-4 flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
