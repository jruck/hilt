"use client";

import { useState, useCallback } from "react";
import { useClaudeStack } from "@/hooks/useClaudeStack";
import { LayerPanel } from "./LayerPanel";
import { ConfigFileList } from "./ConfigFileList";
import { ConfigPreview } from "./ConfigPreview";
import { StackSummary } from "./StackSummary";
import { CreateFileDialog } from "./CreateFileDialog";
import type { ConfigLayer, ConfigFile } from "@/lib/claude-config/types";

interface StackViewProps {
  scopePath: string;
}

export function StackView({ scopePath }: StackViewProps) {
  const { stack, isLoading, isError, mutate } = useClaudeStack(scopePath);
  const [selectedLayer, setSelectedLayer] = useState<ConfigLayer>("project");
  const [selectedFile, setSelectedFile] = useState<ConfigFile | null>(null);
  const [createDialogFile, setCreateDialogFile] = useState<ConfigFile | null>(null);

  const handleFileUpdated = useCallback(() => {
    mutate();
  }, [mutate]);

  const handleCreateFile = useCallback((file: ConfigFile) => {
    setCreateDialogFile(file);
  }, []);

  const handleCreateComplete = useCallback(() => {
    setCreateDialogFile(null);
    mutate();
  }, [mutate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Loading configuration stack...</div>
      </div>
    );
  }

  if (isError || !stack) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Failed to load configuration</div>
      </div>
    );
  }

  const layerFiles = stack.layers[selectedLayer];

  return (
    <div className="flex h-full">
      {/* Left sidebar - Layer navigation + Summary */}
      <div className="w-48 border-r border-[var(--border-primary)] flex flex-col flex-shrink-0">
        <LayerPanel
          layers={stack.layers}
          selectedLayer={selectedLayer}
          onSelectLayer={(layer) => {
            setSelectedLayer(layer);
            setSelectedFile(null);
          }}
        />
        <div className="border-t border-[var(--border-primary)] mt-auto">
          <StackSummary summary={stack.summary} />
        </div>
      </div>

      {/* Middle - File list */}
      <div className="w-64 border-r border-[var(--border-primary)] overflow-y-auto flex-shrink-0">
        <ConfigFileList
          files={layerFiles}
          layer={selectedLayer}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          onCreateFile={handleCreateFile}
        />
      </div>

      {/* Right - Preview/Editor */}
      <div className="flex-1 overflow-hidden">
        {selectedFile ? (
          <ConfigPreview
            file={selectedFile}
            scopePath={scopePath}
            onFileUpdated={handleFileUpdated}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)]">
            <div className="text-lg mb-2">Select a file to preview</div>
            <div className="text-sm">
              Choose a configuration file from the list to view or edit its contents
            </div>
          </div>
        )}
      </div>

      {/* Create file dialog */}
      {createDialogFile && (
        <CreateFileDialog
          file={createDialogFile}
          onClose={() => setCreateDialogFile(null)}
          onCreated={handleCreateComplete}
        />
      )}
    </div>
  );
}
