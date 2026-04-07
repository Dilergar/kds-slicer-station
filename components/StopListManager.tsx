/**
 * StopListManager.tsx — Управление стоп-листом ингредиентов
 *
 * Иерархическое отображение: Родитель → Разновидности (Children).
 * Включение/выключение стопа с причиной. Каскад: стоп ингредиента → стоп блюда.
 * Режим редактора (PIN: 01151995): CRUD разновидностей, загрузка изображений (Base64).
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { IngredientBase } from '../types';
import { Ban, Check, AlertOctagon, Edit2, Plus, Trash2, X, Save, AlertTriangle, Camera, Image as ImageIcon, Lock } from 'lucide-react';
import { PIN_CODE } from '../constants';
import { StopReasonModal } from './StopReasonModal';
import { ConfirmModal } from './ui/ConfirmModal';

interface StopListManagerProps {
  ingredients: IngredientBase[];
  onToggleStop: (id: string, reason?: string) => void;
  onAddIngredient: (name: string, parentId?: string, unitType?: 'kg' | 'piece', pieceWeightGrams?: number) => void;
  onUpdateIngredient: (id: string, updates: Partial<IngredientBase>) => void;
  onDeleteIngredient: (id: string) => void;
  onPreviewImage: (url: string) => void;
}

export const StopListManager: React.FC<StopListManagerProps> = ({
  ingredients,
  onToggleStop,
  onAddIngredient,
  onUpdateIngredient,
  onDeleteIngredient,
  onPreviewImage
}) => {
  // Modal State for STOP REASON
  const [stopModalId, setStopModalId] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [validationError, setValidationError] = useState<string>('');

  // Modal State for VARIETIES
  const [parentModalId, setParentModalId] = useState<string | null>(null);

  // Adding New Variety State
  const [isAddingVariety, setIsAddingVariety] = useState(false);
  const [newVarietyName, setNewVarietyName] = useState('');
  const [newVarietyUnit, setNewVarietyUnit] = useState<'kg' | 'piece'>('kg');

  const [newVarietyWeight, setNewVarietyWeight] = useState<number>(0);

  // Adding New Main Item State
  const [isAddingMainItem, setIsAddingMainItem] = useState(false);
  const [newMainName, setNewMainName] = useState('');
  const [newMainUnit, setNewMainUnit] = useState<'kg' | 'piece'>('kg');
  const [newMainWeight, setNewMainWeight] = useState<number>(0);

  const [editingVarietyId, setEditingVarietyId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingUnit, setEditingUnit] = useState<'kg' | 'piece'>('kg');
  const [editingWeight, setEditingWeight] = useState<number>(0);

  // Editor Mode State
  const [isEditorMode, setIsEditorMode] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  // Parent Editing State (Inside Modal)
  const [isEditingParent, setIsEditingParent] = useState(false);
  const [tempParentName, setTempParentName] = useState('');



  // Image Upload State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingIngredientId, setUploadingIngredientId] = useState<string | null>(null);

  // Confirm Delete Modal State
  const [confirmModalData, setConfirmModalData] = useState<{ id: string, type: 'main' | 'variety' } | null>(null);

  // Get only MAIN ingredients (parents) and sort them
  const parentIngredients = useMemo(() => {
    return ingredients
      .filter(i => !i.parentId)
      .sort((a, b) => {
        const getPriority = (ing: IngredientBase) => {
          if (ing.is_stopped) return 0; // Top priority

          // Check for partial stop
          const children = ingredients.filter(child => child.parentId === ing.id);
          const hasStoppedChildren = children.some(child => child.is_stopped);
          if (hasStoppedChildren) return 1; // Second priority

          return 2; // Last priority
        };

        const priorityA = getPriority(a);
        const priorityB = getPriority(b);

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return a.name.localeCompare(b.name);
      });
  }, [ingredients]);

  // When modal opens, reset editing state
  useEffect(() => {
    if (parentModalId) {
      const parent = ingredients.find(i => i.id === parentModalId);
      if (parent) {
        setTempParentName(parent.name);
      }
      // Note: We do NOT reset setIsEditingParent(false) here, 
      // because handleEditMainItemClick sets it to true before this effect runs.
      // Instead, we reset it strictly in openVarietyModal.
      setIsAddingVariety(false);
      setNewVarietyName('');
    }
  }, [parentModalId, ingredients]);

  // Stop Handlers
  const handleStopClick = (e: React.MouseEvent, ing: IngredientBase) => {
    e.stopPropagation(); // Prevent opening variety modal
    if (ing.is_stopped) {
      onToggleStop(ing.id);
    } else {
      setStopModalId(ing.id);
      setReason('Out of Stock');
      setCustomReason('');
      setValidationError('');
    }
  };

  const confirmStop = () => {
    let finalReason = reason;
    if (reason === 'Other') {
      if (!customReason.trim()) {
        setValidationError('Please enter a reason.');
        return;
      }
      finalReason = customReason.trim();
    }
    if (stopModalId) {
      onToggleStop(stopModalId, finalReason);
      setStopModalId(null);
    }
  };

  // Variety Modal Handlers
  const openVarietyModal = (parentId: string) => {
    setParentModalId(parentId);
    setIsEditingParent(false); // Explicitly View Mode
  };

  const handleEditMainItemClick = (e: React.MouseEvent, ing: IngredientBase) => {
    e.stopPropagation();
    setParentModalId(ing.id);
    setIsEditingParent(true); // Explicitly Edit Mode
  };

  const handleDeleteMainItemClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmModalData({ id, type: 'main' });
  };

  const handleUpdateVariety = (id: string) => {
    if (editingName.trim()) {
      onUpdateIngredient(id, {
        name: editingName.trim(),
        unitType: editingUnit,
        pieceWeightGrams: editingUnit === 'piece' ? editingWeight : undefined
      });
      setEditingVarietyId(null);
    }
  };

  const handleSaveNewVariety = () => {
    if (newVarietyName.trim() && parentModalId) {
      onAddIngredient(newVarietyName.trim(), parentModalId, newVarietyUnit, newVarietyWeight);
      setIsAddingVariety(false);
      setNewVarietyName('');
      setNewVarietyUnit('kg');
      setNewVarietyWeight(0);
    }
  };



  const handleSaveNewMainItem = () => {
    if (newMainName.trim()) {
      onAddIngredient(newMainName.trim(), undefined, newMainUnit, newMainWeight);
      setIsAddingMainItem(false);
      setNewMainName('');
      setNewMainUnit('kg');
      setNewMainWeight(0);
    }
  };

  // Parent Actions (Inside Modal)
  const handleSaveParentName = () => {
    if (parentModalId && tempParentName.trim()) {
      onUpdateIngredient(parentModalId, { name: tempParentName.trim() });
      setIsEditingParent(false);
    }
  };

  const handleDeleteParent = () => {
    if (parentModalId) {
      setConfirmModalData({ id: parentModalId, type: 'main' });
    }
  };

  // Auth Handlers for Editor Mode
  const handleToggleEditorMode = () => {
    if (isEditorMode) {
      // Turn OFF immediately
      setIsEditorMode(false);
    } else {
      // Turn ON requires PIN
      setShowAuthModal(true);
      setPinInput('');
      setPinError(false);
    }
  };

  const verifyPin = () => {
    if (pinInput === PIN_CODE) {
      setIsEditorMode(true);
      setShowAuthModal(false);
    } else {
      setPinError(true);
    }
  };



  // Image Upload Logic
  const triggerImageUpload = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setUploadingIngredientId(id);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadingIngredientId) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        onUpdateIngredient(uploadingIngredientId, { imageUrl: base64String });
        setUploadingIngredientId(null);
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex-1 bg-kds-bg p-8 overflow-y-auto">
      {/* Hidden File Input for uploads */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />

      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Stop List Manager</h1>
          <p className="text-gray-400">Manage Main Ingredients and their specific varieties.</p>
        </div>
        <div className="flex items-center gap-3 bg-slate-800 p-2 rounded-lg border border-slate-700">
          <span className={`text-sm font-bold ${isEditorMode ? 'text-white' : 'text-slate-400'}`}>Editor Mode</span>
          <button
            onClick={handleToggleEditorMode}
            className={`w-12 h-6 rounded-full relative transition-colors duration-300 focus:outline-none
                 ${isEditorMode ? 'bg-blue-600' : 'bg-slate-600'}
               `}
          >
            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform duration-300
                 ${isEditorMode ? 'translate-x-6' : 'translate-x-0'}
               `}></div>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {parentIngredients.map(ing => {
          // Check if any children are stopped
          const children = ingredients.filter(child => child.parentId === ing.id);
          const hasStoppedChildren = children.some(child => child.is_stopped);

          return (
            <div
              key={ing.id}
              onClick={() => openVarietyModal(ing.id)}
              className={`
                relative p-6 rounded-lg border-2 transition-all duration-300 cursor-pointer group hover:shadow-xl h-full min-h-[120px]
                ${ing.is_stopped
                  ? 'bg-gray-900 border-red-900/50 opacity-80'
                  : hasStoppedChildren
                    ? 'bg-kds-card border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.3)]'
                    : 'bg-kds-card border-slate-700 hover:border-blue-500'
                }
              `}
            >
              <div className="flex justify-between items-start mb-4">

                {/* AVATAR IMAGE & TITLE */}
                <div className="flex items-start flex-1 mr-4 min-w-0">
                  {/* Main Item Avatar */}
                  <div
                    className="relative w-20 h-20 shrink-0 mr-4 rounded-lg overflow-hidden border border-slate-600 bg-slate-800 cursor-zoom-in"
                    onClick={(e) => e.stopPropagation()} // Stop propagation to prevent opening modal on single click
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (ing.imageUrl) onPreviewImage(ing.imageUrl);
                    }}
                  >
                    {ing.imageUrl ? (
                      <img src={ing.imageUrl} alt={ing.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="text-slate-600" size={32} />
                      </div>
                    )}
                  </div>

                  <div className="flex-1">
                    <h3 className={`font-bold text-xl leading-tight ${ing.is_stopped ? 'text-gray-500' : 'text-white'}`}>
                      {ing.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-slate-500 font-mono block">
                        {children.length} Varieties
                      </span>
                      {ing.unitType === 'piece' && (
                        <span className="text-xs text-blue-400 font-mono block mt-1">
                          1 pc ≈ {ing.pieceWeightGrams}g
                        </span>
                      )}
                      {/* Indicator text if children are stopped but parent is active */}
                      {!ing.is_stopped && hasStoppedChildren && (
                        <span className="text-[10px] font-bold text-orange-400 bg-orange-900/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle size={10} /> PARTIAL STOP
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  {/* Stop Toggle */}
                  <button
                    onClick={(e) => handleStopClick(e, ing)}
                    className={`w-12 h-7 rounded-full relative transition-colors duration-300 focus:outline-none shrink-0
                        ${ing.is_stopped ? 'bg-red-900/50' : 'bg-green-900/50'}
                      `}
                  >
                    <div className={`absolute top-1 w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center
                        ${ing.is_stopped ? 'translate-x-1 bg-red-500' : 'translate-x-6 bg-green-500'}
                    `}>
                      {ing.is_stopped ? <Ban size={10} className="text-white" /> : <Check size={10} className="text-white" />}
                    </div>
                  </button>

                  {/* Main Item Actions: Image, Edit, Delete - ONLY IN EDITOR MODE */}
                  {isEditorMode && (
                    <div className="flex items-center gap-1 mt-1 bg-slate-800/50 p-1 rounded-md border border-slate-700/50">
                      <button
                        onClick={(e) => triggerImageUpload(e, ing.id)}
                        className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors"
                        title="Upload Photo"
                      >
                        <ImageIcon size={14} />
                      </button>
                      <button
                        onClick={(e) => handleEditMainItemClick(e, ing)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteMainItemClick(e, ing.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {ing.is_stopped && (
                <div className="bg-red-900/20 p-2 rounded border border-red-900/50 text-red-500 text-xs font-bold uppercase text-center mt-2">
                  Stopped: {ing.stop_reason}
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 h-1 bg-blue-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left rounded-b-lg"></div>
            </div>
          );
        })}

        {/* Add New Parent (Simulated) - ONLY IN EDITOR MODE */}
        {isEditorMode && (
          <div
            onClick={() => setIsAddingMainItem(true)}
            className="h-full border-2 border-dashed border-slate-700 rounded-lg flex flex-col items-center justify-center p-6 cursor-pointer hover:border-slate-500 hover:bg-slate-800/30 transition-colors text-slate-500 hover:text-slate-300 min-h-[120px]"
          >
            <Plus size={32} />
            <span className="font-bold text-sm mt-2">Add Main Item</span>
          </div>
        )}
      </div>

      {/* -------------------- ADD MAIN ITEM MODAL -------------------- */}
      {isAddingMainItem && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60]">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-blue-500/30 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex items-center text-blue-500 mb-4">
              <Plus className="mr-2" />
              <h3 className="text-lg font-bold text-white">Add Main Ingredient</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 font-bold uppercase block mb-1">Name</label>
                <input
                  autoFocus
                  value={newMainName}
                  onChange={(e) => setNewMainName(e.target.value)}
                  placeholder="e.g. Potatoes"
                  className="w-full bg-gray-900 text-white p-3 rounded border border-gray-700 focus:border-blue-500 outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveNewMainItem()}
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold uppercase block mb-1">Unit Type</label>
                <div className="flex bg-gray-900 rounded border border-gray-700 p-1">
                  <button
                    onClick={() => setNewMainUnit('kg')}
                    className={`flex-1 py-2 rounded text-sm font-bold transition-colors ${newMainUnit === 'kg' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    KG
                  </button>
                  <button
                    onClick={() => setNewMainUnit('piece')}
                    className={`flex-1 py-2 rounded text-sm font-bold transition-colors ${newMainUnit === 'piece' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    PIECE
                  </button>
                </div>
              </div>

              {newMainUnit === 'piece' && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="text-xs text-slate-400 font-bold uppercase block mb-1">Weight per Piece (grams)</label>
                  <input
                    type="number"
                    value={newMainWeight || ''}
                    onChange={(e) => setNewMainWeight(parseInt(e.target.value))}
                    placeholder="e.g. 150"
                    className="w-full bg-gray-900 text-white p-3 rounded border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={handleSaveNewMainItem} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded">
                  Create
                </button>
                <button onClick={() => setIsAddingMainItem(false)} className="flex-1 bg-transparent border border-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* -------------------- VARIETIES MODAL -------------------- */}
      {
        parentModalId && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-kds-card w-full max-w-2xl rounded-lg border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900">
                <div className="flex-1 pr-4">
                  {isEditingParent ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={tempParentName}
                        onChange={(e) => setTempParentName(e.target.value)}
                        className="bg-slate-800 text-white text-xl font-bold p-2 rounded border border-blue-500 outline-none w-full"
                      />
                      <button onClick={handleSaveParentName} className="p-2 bg-green-600 rounded text-white hover:bg-green-500"><Save size={20} /></button>
                      <button onClick={() => setIsEditingParent(false)} className="p-2 bg-slate-700 rounded text-white hover:bg-slate-600"><X size={20} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div>
                        <h2 className="text-2xl font-bold text-white">
                          {ingredients.find(i => i.id === parentModalId)?.name}
                        </h2>
                        <p className="text-slate-400 text-sm">Manage specific kinds and varieties</p>
                      </div>
                      <div className="flex items-center gap-1 ml-4 bg-slate-800 p-1 rounded-lg border border-slate-700">
                        {isEditorMode && (
                          <button
                            onClick={() => { setIsAddingVariety(true); setNewVarietyName(''); }}
                            className="p-2 text-blue-400 hover:bg-slate-700 rounded transition-colors"
                            title="Add New Variety"
                          >
                            <Plus size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={() => setParentModalId(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-3">

                {/* ADD NEW VARIETY ROW */}
                {isAddingVariety && (
                  <div className="flex items-center justify-between p-4 bg-blue-900/20 rounded border border-blue-500 animate-in fade-in slide-in-from-top-2">
                    <div className="flex flex-1 items-center gap-2 mr-4">
                      <div className="flex flex-col flex-1 gap-2">
                        <input
                          autoFocus
                          value={newVarietyName}
                          onChange={(e) => setNewVarietyName(e.target.value)}
                          placeholder="Name..."
                          className="flex-1 bg-slate-900 text-white p-2 rounded border border-blue-400 outline-none"
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveNewVariety()}
                        />
                        <div className="flex items-center gap-2">
                          <select
                            value={newVarietyUnit}
                            onChange={(e) => setNewVarietyUnit(e.target.value as 'kg' | 'piece')}
                            className="bg-slate-900 text-white p-1 rounded border border-blue-400 text-xs"
                          >
                            <option value="kg">Kg</option>
                            <option value="piece">Piece</option>
                          </select>
                          {newVarietyUnit === 'piece' && (
                            <input
                              type="number"
                              placeholder="Weight (g)"
                              value={newVarietyWeight || ''}
                              onChange={(e) => setNewVarietyWeight(parseInt(e.target.value))}
                              className="bg-slate-900 text-white p-1 rounded border border-blue-400 text-xs w-20"
                            />
                          )}
                        </div>
                      </div>
                      <button onClick={handleSaveNewVariety} className="p-2 bg-blue-600 rounded text-white hover:bg-blue-500"><Check size={16} /></button>
                      <button onClick={() => setIsAddingVariety(false)} className="p-2 bg-slate-700 rounded text-white hover:bg-slate-600"><X size={16} /></button>
                    </div>
                  </div>
                )}

                {ingredients.filter(i => i.parentId === parentModalId).map(child => (
                  <div key={child.id} className="flex items-center justify-between p-4 bg-slate-800/50 rounded border border-slate-700 hover:border-slate-600 transition-colors">
                    {editingVarietyId === child.id ? (
                      // Edit Mode
                      // Edit Mode
                      <div className="flex flex-1 items-center gap-2 mr-4 animate-in fade-in">
                        <div className="flex flex-col flex-1 gap-2">
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="w-full bg-slate-900 text-white p-2 rounded border border-blue-500 outline-none"
                          />
                          <div className="flex items-center gap-2">
                            <select
                              value={editingUnit}
                              onChange={(e) => setEditingUnit(e.target.value as 'kg' | 'piece')}
                              className="bg-slate-900 text-white p-1 rounded border border-blue-400 text-xs"
                            >
                              <option value="kg">Kg</option>
                              <option value="piece">Piece</option>
                            </select>
                            {editingUnit === 'piece' && (
                              <input
                                type="number"
                                placeholder="Weight (g)"
                                value={editingWeight || ''}
                                onChange={(e) => setEditingWeight(parseInt(e.target.value))}
                                className="bg-slate-900 text-white p-1 rounded border border-blue-400 text-xs w-20"
                              />
                            )}
                          </div>
                        </div>
                        <button onClick={() => handleUpdateVariety(child.id)} className="p-2 bg-green-600 rounded text-white h-full max-h-10 self-center"><Check size={16} /></button>
                        <button onClick={() => setEditingVarietyId(null)} className="p-2 bg-slate-700 rounded text-white h-full max-h-10 self-center"><X size={16} /></button>
                      </div>
                    ) : (
                      // View Mode
                      <div className="flex items-center gap-3">
                        {/* VARIETY AVATAR */}
                        <div
                          className="relative w-12 h-12 rounded-md overflow-hidden bg-slate-700 border border-slate-600 shrink-0 cursor-zoom-in"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={() => child.imageUrl && onPreviewImage(child.imageUrl)}
                        >
                          {child.imageUrl ? (
                            <img src={child.imageUrl} alt={child.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="text-slate-500" size={20} />
                            </div>
                          )}
                        </div>

                        <span className={`font-medium text-lg ${child.is_stopped ? 'text-gray-500 line-through' : 'text-white'}`}>
                          {child.name}
                          {child.unitType === 'piece' && <span className="text-xs text-blue-400 ml-2 font-normal">(1pc ≈ {child.pieceWeightGrams}g)</span>}
                        </span>
                        {child.is_stopped && <span className="text-xs text-red-500 font-bold bg-red-900/20 px-2 py-0.5 rounded">STOPPED</span>}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {/* VARIETY TOGGLE SWITCH */}
                      <button
                        onClick={(e) => handleStopClick(e, child)}
                        className={`w-12 h-7 rounded-full relative transition-colors duration-300 focus:outline-none shrink-0
                                 ${child.is_stopped ? 'bg-red-900/50' : 'bg-green-900/50'}
                              `}
                      >
                        <div className={`absolute top-1 w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center
                                    ${child.is_stopped ? 'translate-x-1 bg-red-500' : 'translate-x-6 bg-green-500'}
                              `}>
                          {child.is_stopped ? <Ban size={10} className="text-white" /> : <Check size={10} className="text-white" />}
                        </div>
                      </button>

                      <div className="w-px h-6 bg-slate-700 mx-2"></div>

                      {isEditorMode && (
                        <>
                          <button
                            onClick={(e) => triggerImageUpload(e, child.id)}
                            className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-blue-400"
                            title="Upload Photo"
                          >
                            <ImageIcon size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingVarietyId(child.id);
                              setEditingName(child.name);
                              setEditingUnit(child.unitType || 'kg');
                              setEditingWeight(child.pieceWeightGrams || 0);
                            }}
                            className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => setConfirmModalData({ id: child.id, type: 'variety' })}
                            className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {ingredients.filter(i => i.parentId === parentModalId).length === 0 && !isAddingVariety && (
                  <div className="text-center py-8 text-slate-500 italic">No varieties added yet.</div>
                )}
              </div>

              {/* Footer */}
              <div className="p-6 bg-slate-900 border-t border-slate-700">
                <button
                  onClick={() => setParentModalId(null)}
                  className="w-full bg-green-600 hover:bg-green-500 text-white py-3 rounded font-bold uppercase tracking-widest shadow-glow-green transition-all"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* -------------------- STOP REASON MODAL -------------------- */}
      <StopReasonModal
        isOpen={!!stopModalId}
        itemName={ingredients.find(i => i.id === stopModalId)?.name || ''}
        onClose={() => {
          setStopModalId(null);
          // setReason(''); // This state variable is no longer needed here as StopReasonModal manages its own reason state.
        }}
        onConfirm={(reason) => {
          if (stopModalId) {
            onToggleStop(stopModalId, reason);
            setStopModalId(null);
            // setReason(''); // This state variable is no longer needed here.
          }
        }}
      />


      {/* -------------------- PIN AUTH MODAL -------------------- */}
      {
        showAuthModal && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[70]">
            <div className="bg-gray-800 p-6 rounded-lg w-72 text-center border border-gray-600 shadow-2xl animate-in fade-in zoom-in duration-200">
              <Lock size={32} className="mx-auto text-blue-500 mb-4" />
              <h3 className="text-white font-bold mb-2">Security Check</h3>
              <p className="text-xs text-gray-400 mb-4">
                Enter Supervisor PIN to enable Editor Mode.
              </p>

              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                className={`w-full bg-gray-900 text-white text-center text-xl tracking-widest p-2 rounded border mb-4 outline-none
                ${pinError ? 'border-red-500' : 'border-gray-700 focus:border-blue-500'}
              `}
                placeholder="••••••••"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && verifyPin()}
              />
              {pinError && <p className="text-red-500 text-xs mb-3">Incorrect PIN</p>}

              <div className="grid grid-cols-2 gap-2">
                <button onClick={verifyPin} className="bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-500">
                  Unlock
                </button>
                <button onClick={() => setShowAuthModal(false)} className="bg-gray-700 text-white py-2 rounded hover:bg-gray-600">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* -------------------- CONFIRM DELETE MODAL -------------------- */}
      <ConfirmModal
        isOpen={!!confirmModalData}
        onClose={() => setConfirmModalData(null)}
        title={confirmModalData?.type === 'main' ? "Delete Main Item?" : "Delete Variety?"}
        description={
          confirmModalData?.type === 'main' 
            ? "Are you sure you want to delete this Main Item? All its varieties will also be permanently deleted."
            : "Are you sure you want to delete this variety?"
        }
        onConfirm={() => {
          if (confirmModalData) {
            if (confirmModalData.type === 'main' && parentModalId === confirmModalData.id) {
              setParentModalId(null);
            }
            onDeleteIngredient(confirmModalData.id);
            setConfirmModalData(null);
          }
        }}
      />
    </div >
  );
};