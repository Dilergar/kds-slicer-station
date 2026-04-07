import React, { useState, useRef, useEffect } from 'react';
import { Category, Dish, IngredientBase, PriorityLevel } from '../../types';
import { Plus, X, ArrowDown, AlertOctagon, Ban, Check, Edit2, Trash2, Camera, Save } from 'lucide-react';
import { ConfirmModal } from '../ui/ConfirmModal';

interface RecipeEditorProps {
  categories: Category[];
  dishes: Dish[];
  setDishes: (dishes: Dish[]) => void;
  ingredients: IngredientBase[];
  handleStopClick: (e: React.MouseEvent, dish: Dish) => void;
}

export const RecipeEditor: React.FC<RecipeEditorProps> = ({ 
  categories, 
  dishes, 
  setDishes, 
  ingredients, 
  handleStopClick 
}) => {
  const [recipeSearchTerm, setRecipeSearchTerm] = useState('');
  const [isEditingDish, setIsEditingDish] = useState(false);
  const [currentDish, setCurrentDish] = useState<Partial<Dish>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const toggleCategory = (catId: string) => {
    setExpandedCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  };

  const handleEditDish = (dish: Dish) => {
    setCurrentDish({ ...dish });
    setFormError(null);
    setIsEditingDish(true);
  };

  const handleAddDish = () => {
    setCurrentDish({
      id: `d${Date.now()}`,
      name: '',
      category_ids: [],
      priority_flag: PriorityLevel.NORMAL,
      grams_per_portion: 0,
      ingredients: [],
      image_url: '',
      is_stopped: false,
      stop_reason: ''
    });
    setFormError(null);
    setIsEditingDish(true);
  };

  const handleDeleteDish = (id: string) => {
    setConfirmDeleteId(id);
  };

  const saveDishForm = () => {
    if (!currentDish.name || !currentDish.category_ids?.length) {
      setFormError("Name and at least one Category are required!");
      return;
    }

    const isVip = currentDish.category_ids.includes('c_vip');
    if (isVip && currentDish.category_ids.length === 1) {
      setFormError("Error: 'Vip' category cannot be selected alone. You must select at least one other category.");
      return;
    }

    if (dishes.find(d => d.id === currentDish.id)) {
      setDishes(dishes.map(d => d.id === currentDish.id ? currentDish as Dish : d));
    } else {
      setDishes([...dishes, currentDish as Dish]);
    }
    setIsEditingDish(false);
    setCurrentDish({});
    setFormError(null);
  };

  const toggleIngredientSelection = (ingId: string) => {
    const currentIngs = currentDish.ingredients || [];
    const exists = currentIngs.find(i => i.id === ingId);

    if (exists) {
      setCurrentDish({ ...currentDish, ingredients: currentIngs.filter(i => i.id !== ingId) });
    } else {
      setCurrentDish({ ...currentDish, ingredients: [...currentIngs, { id: ingId, quantity: 0 }] });
    }
  };

  const updateIngredientQuantity = (ingId: string, qty: number) => {
    const currentIngs = currentDish.ingredients || [];
    setCurrentDish({
      ...currentDish,
      ingredients: currentIngs.map(i => i.id === ingId ? { ...i, quantity: qty } : i)
    });
  };

  const triggerImageUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setFormError('Image size must be less than 2MB.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setFormError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCurrentDish(prev => ({ ...prev, image_url: reader.result as string }));
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (!currentDish.ingredients) return;

    const totalWeight = currentDish.ingredients.reduce((acc, dishIng) => {
      const ingDef = ingredients.find(i => i.id === dishIng.id);
      if (!ingDef) return acc;

      if (ingDef.unitType === 'piece') {
        return acc + (dishIng.quantity * (ingDef.pieceWeightGrams || 0));
      } else {
        return acc + dishIng.quantity;
      }
    }, 0);

    setCurrentDish(prev => ({ ...prev, grams_per_portion: totalWeight }));
  }, [currentDish.ingredients, ingredients]);

  return (
    <div className="relative">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
      />
      <div className="flex justify-between items-center mb-6">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search recipes..."
            value={recipeSearchTerm}
            onChange={(e) => setRecipeSearchTerm(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:border-blue-500 outline-none"
          />
          <div className="absolute left-3 top-2.5 text-gray-400 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          </div>
          {recipeSearchTerm && (
            <button
              onClick={() => setRecipeSearchTerm('')}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <button
          onClick={handleAddDish}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 flex items-center gap-2 font-bold ml-4"
        >
          <Plus size={20} /> Add New Recipe
        </button>
      </div>

      <div className="space-y-4">
        {categories.filter(c => c.name.toLowerCase() !== 'vip').map(category => {
          const categoryDishes = dishes.filter(d =>
            d.category_ids?.includes(category.id) &&
            d.name.toLowerCase().includes(recipeSearchTerm.toLowerCase())
          );
          if (categoryDishes.length === 0) return null;

          const isSearching = recipeSearchTerm.length > 0;
          const isExpanded = expandedCategoryIds.includes(category.id) || isSearching;
          const hasStopped = categoryDishes.some(d => d.is_stopped);

          const sortedDishes = categoryDishes.sort((a, b) => {
            if (a.is_stopped !== b.is_stopped) return a.is_stopped ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

          return (
            <div
              key={category.id}
              className={`border rounded-lg overflow-hidden transition-all duration-300
                ${hasStopped
                  ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.25)] bg-red-900/10'
                  : 'border-gray-700 bg-gray-900/30'
                }
              `}
            >
              <button
                onClick={() => toggleCategory(category.id)}
                className={`w-full flex items-center justify-between p-4 transition-colors
                   ${hasStopped ? 'bg-red-900/20 hover:bg-red-900/30' : 'bg-gray-800 hover:bg-gray-700'}
                `}
              >
                <div className="flex items-center gap-3">
                  <span className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                    <ArrowDown size={20} className={hasStopped ? "text-red-400" : "text-gray-400"} />
                  </span>
                  <h2 className={`text-lg font-bold uppercase tracking-wide flex items-center gap-2 ${hasStopped ? 'text-red-100 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'text-gray-200'}`}>
                    {category.name}
                    {hasStopped && <AlertOctagon size={18} className="text-red-500 animate-pulse" />}
                  </h2>
                  <span className={`${hasStopped ? 'bg-red-900/50 text-red-200' : 'bg-blue-900/50 text-blue-300'} text-xs px-2 py-0.5 rounded-full font-mono`}>
                    {sortedDishes.length}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-gray-900/20 border-t border-gray-700">
                  {sortedDishes.map(dish => {
                    const isVip = dish.category_ids?.some(id => categories.find(c => c.id === id)?.name.toLowerCase() === 'vip');
                    return (
                      <div key={dish.id} className={`bg-kds-card rounded-lg p-4 border relative group border-gray-700`}>
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => handleStopClick(e, dish)}
                              className={`w-12 h-7 rounded-full relative transition-colors duration-300 focus:outline-none shrink-0
                                     ${dish.is_stopped ? 'bg-red-900/50' : 'bg-green-900/50'}
                                  `}
                            >
                              <div className={`absolute top-1 w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center
                                        ${dish.is_stopped ? 'translate-x-1 bg-red-500' : 'translate-x-6 bg-green-500'}
                                  `}>
                                {dish.is_stopped ? <Ban size={10} className="text-white" /> : <Check size={10} className="text-white" />}
                              </div>
                            </button>
                            <img src={dish.image_url || "https://via.placeholder.com/150"} className="w-16 h-16 rounded object-cover bg-gray-800" alt="" />
                            <div>
                              <h3 className="font-bold text-white text-lg leading-tight flex items-center gap-2">
                                {dish.name}
                                {isVip && (
                                  <span className="text-yellow-400 border-2 border-yellow-400 text-[10px] px-1 rounded-sm -rotate-6 font-black tracking-widest shadow-[0_0_10px_rgba(250,204,21,0.5)] bg-yellow-400/10 select-none">
                                    VIP
                                  </span>
                                )}
                                {dish.priority_flag === PriorityLevel.ULTRA && (
                                  <span className="text-red-500 border border-red-500 text-[10px] px-1 rounded -rotate-6 font-black tracking-widest shadow-[0_0_10px_rgba(239,68,68,0.6)] bg-red-500/10 animate-pulse select-none">
                                    ULTRA
                                  </span>
                                )}
                              </h3>
                              <p className="text-xs text-gray-500 font-mono mt-0.5">{dish.ingredients.length} ingredients</p>
                              {dish.is_stopped && (
                                <div className="mt-1">
                                  <span className="text-[10px] text-red-500 font-bold bg-red-900/20 px-1.5 py-0.5 rounded border border-red-900">
                                    STOPPED: {dish.stop_reason || 'Manual'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleEditDish(dish)}
                              className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                            >
                              <Edit2 size={18} />
                            </button>
                            <button
                              onClick={() => handleDeleteDish(dish.id)}
                              className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-red-400"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>

                        <div className="bg-gray-800/50 p-3 rounded space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Weight:</span>
                            <span className="text-gray-300 font-mono">{dish.grams_per_portion}g</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block mb-1">Ingredients:</span>
                            <div className="flex flex-wrap gap-1">
                              {dish.ingredients.map(dishIng => {
                                const ing = ingredients.find(i => i.id === dishIng.id);
                                return ing ? (
                                  <span key={dishIng.id} className="text-xs bg-gray-700 px-1.5 py-0.5 rounded text-gray-300 flex items-center gap-1">
                                    {ing.name}
                                    <span className="text-blue-400 font-bold">
                                      {dishIng.quantity}{ing.unitType === 'piece' ? 'pcs' : 'g'}
                                    </span>
                                  </span>
                                ) : null;
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {(() => {
          const unknownDishes = dishes.filter(d => !d.category_ids || d.category_ids.length === 0);
          if (unknownDishes.length === 0) return null;

          const isExpanded = expandedCategoryIds.includes('unknown');
          const sortedUnknown = unknownDishes.sort((a, b) => {
            if (a.is_stopped !== b.is_stopped) return a.is_stopped ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

          return (
            <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-900/30 border-dashed">
              <button
                onClick={() => toggleCategory('unknown')}
                className="w-full flex items-center justify-between p-4 bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                    <ArrowDown size={20} className="text-gray-400" />
                  </span>
                  <h2 className="text-lg font-bold text-gray-400 uppercase tracking-wide">
                    Uncategorized
                  </h2>
                  <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full font-mono">
                    {sortedUnknown.length}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-gray-900/20 border-t border-gray-700">
                  {sortedUnknown.map(dish => (
                    <div key={dish.id} className="bg-kds-card rounded-lg p-4 border border-gray-700 relative group opacity-75 hover:opacity-100 transition-opacity">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-gray-800 rounded flex items-center justify-center text-gray-600 font-bold">?</div>
                          <div>
                            <h3 className="font-bold text-white text-lg">{dish.name}</h3>
                            <p className="text-xs text-red-400 font-mono">No Category</p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => handleEditDish(dish)} className="p-2 hover:bg-gray-700 rounded text-white"><Edit2 size={18} /></button>
                          <button onClick={() => handleDeleteDish(dish.id)} className="p-2 hover:bg-gray-700 rounded text-red-400"><Trash2 size={18} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {isEditingDish && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-gray-700 shadow-2xl flex flex-col">
            <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-gray-900/50 sticky top-0 z-10 backdrop-blur-md">
              <h2 className="text-2xl font-bold text-white">
                {dishes.find(d => d.id === currentDish.id) ? 'Edit Recipe' : 'New Recipe'}
              </h2>
              <button onClick={() => setIsEditingDish(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-gray-400 text-sm font-bold mb-2">Recipe Name</label>
                  <input
                    type="text"
                    value={currentDish.name || ''}
                    onChange={(e) => setCurrentDish({ ...currentDish, name: e.target.value })}
                    className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 outline-none"
                    placeholder="e.g. Caeser Salad"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gray-400 text-sm font-bold mb-2">Categories (Max 3)</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {currentDish.category_ids?.map(catId => {
                        const cat = categories.find(c => c.id === catId);
                        if (!cat) return null;
                        return (
                          <span key={catId} className="bg-blue-600 text-white px-2 py-1 rounded text-sm flex items-center gap-1">
                            {cat.name}
                            <button
                              onClick={() => setCurrentDish({
                                ...currentDish,
                                category_ids: currentDish.category_ids?.filter(id => id !== catId)
                              })}
                              className="hover:text-red-300"
                            >
                              <X size={14} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    {(!currentDish.category_ids || currentDish.category_ids.length < 3) && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            setCurrentDish({
                              ...currentDish,
                              category_ids: [...(currentDish.category_ids || []), e.target.value]
                            });
                          }
                        }}
                        className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 outline-none appearance-none"
                      >
                        <option value="">+ Add Category</option>
                        {categories
                          .filter(c => !currentDish.category_ids?.includes(c.id))
                          .map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                      </select>
                    )}
                  </div>
                  <select
                    value={currentDish.priority_flag || PriorityLevel.NORMAL}
                    onChange={(e) => setCurrentDish({ ...currentDish, priority_flag: parseInt(e.target.value) })}
                    className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 outline-none appearance-none"
                  >
                    <option value={PriorityLevel.NORMAL}>Normal</option>
                    <option value={PriorityLevel.ULTRA}>ULTRA</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gray-400 text-sm font-bold mb-2">Total Weight (Calculated)</label>
                  <div className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-blue-400 font-bold font-mono">
                    {currentDish.grams_per_portion || 0} g
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 text-sm font-bold mb-2">Image</label>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={triggerImageUpload}
                      className={`flex flex-1 items-center justify-center gap-2 p-3 rounded border transition-colors font-bold
                              ${currentDish.image_url
                          ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700'
                          : 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'}
                          `}
                    >
                      <Camera size={20} />
                      {currentDish.image_url ? 'Change Image' : 'Upload Image'}
                    </button>
                  </div>
                  {currentDish.image_url && (
                    <div className="mt-2 relative group">
                      <img src={currentDish.image_url} alt="Preview" className="h-32 w-full object-cover rounded border border-gray-700" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                        <button
                          onClick={() => setCurrentDish({ ...currentDish, image_url: '' })}
                          className="text-red-400 hover:text-red-300 flex items-center gap-1 font-bold bg-black/60 px-3 py-1 rounded"
                        >
                          <Trash2 size={16} /> Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 flex flex-col h-full">
                <div className="mb-4 flex-1 overflow-y-auto max-h-[250px] border-b border-gray-700 pb-4">
                  <label className="block text-blue-400 text-sm font-bold mb-3 uppercase tracking-wider">
                    Selected Ingredients ({currentDish.ingredients?.length || 0})
                  </label>
                  {currentDish.ingredients?.length === 0 && <p className="text-gray-500 italic text-sm">No ingredients selected.</p>}

                  <div className="space-y-2">
                    {currentDish.ingredients?.map(dishIng => {
                      const ing = ingredients.find(i => i.id === dishIng.id);
                      if (!ing) return null;
                      return (
                        <div key={dishIng.id} className="bg-gray-800 p-2 rounded border border-blue-500/50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <img src={ing.imageUrl} className="w-8 h-8 rounded object-cover" alt="" />
                            <div>
                              <p className="text-white font-medium text-sm">{ing.name}</p>
                              {ing.unitType === 'piece' && <p className="text-xs text-blue-400">{ing.pieceWeightGrams}g / pc</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              placeholder="Qty"
                              value={dishIng.quantity || ''}
                              onChange={(e) => updateIngredientQuantity(dishIng.id, parseFloat(e.target.value))}
                              className="w-20 bg-gray-900 border border-blue-500 text-white p-1 rounded text-right font-mono font-bold outline-none focus:ring-1 ring-blue-500"
                              autoFocus
                            />
                            <span className="text-xs text-gray-400 w-8">{ing.unitType === 'piece' ? 'pcs' : 'g'}</span>
                            <button onClick={() => toggleIngredientSelection(ing.id)} className="p-1 hover:bg-red-900/50 rounded text-red-400">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pt-2">
                  <label className="block text-gray-400 text-sm font-bold mb-3 uppercase tracking-wider">Add Ingredients</label>
                  <div className="space-y-1">
                    {ingredients.filter(i => !i.parentId).map(parent => {
                      const variations = ingredients.filter(i => i.parentId === parent.id);
                      const isSelected = currentDish.ingredients?.some(i => i.id === parent.id);

                      return (
                        <div key={parent.id} className="mb-2">
                          <div
                            className={`p-2 rounded flex items-center justify-between cursor-pointer transition-colors
                                                    ${isSelected
                                ? 'opacity-50 cursor-not-allowed bg-gray-800 border border-gray-700'
                                : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:border-blue-500'}
                                                `}
                            onClick={() => !isSelected && toggleIngredientSelection(parent.id)}
                          >
                            <div className="flex items-center gap-2">
                              <img src={parent.imageUrl} className="w-8 h-8 rounded object-cover" alt="" />
                              <span className="font-medium">{parent.name}</span>
                            </div>
                            {isSelected ? <span className="text-xs text-green-500">Added</span> : <Plus size={16} />}
                          </div>

                          {variations.length > 0 && (
                            <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-700 pl-2">
                              {variations.map(v => {
                                const isVarSelected = currentDish.ingredients?.some(i => i.id === v.id);
                                return (
                                  <div
                                    key={v.id}
                                    className={`p-1.5 rounded flex items-center justify-between cursor-pointer text-sm
                                                                    ${isVarSelected
                                        ? 'opacity-50 cursor-not-allowed text-gray-500'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-800'}
                                                                `}
                                    onClick={() => !isVarSelected && toggleIngredientSelection(v.id)}
                                  >
                                    <span>{v.name}</span>
                                    {isVarSelected ? <Check size={12} /> : <Plus size={12} />}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {formError && (
              <div className="mx-8 mb-4 bg-red-500/20 border border-red-500 text-red-100 px-4 py-3 rounded-lg flex items-center shadow-[0_0_15px_rgba(239,68,68,0.2)] animate-pulse">
                <AlertOctagon className="w-5 h-5 mr-3 text-red-500 flex-shrink-0" />
                <span className="font-bold">{formError}</span>
              </div>
            )}

            <div className="flex justify-end space-x-4 mt-6 border-t border-gray-700 p-6">
              <button
                onClick={() => {
                  setIsEditingDish(false);
                  setFormError(null);
                }}
                className="px-6 py-2 text-gray-400 font-bold hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveDishForm}
                className="px-8 py-3 rounded bg-green-600 hover:bg-green-500 text-white font-bold shadow-lg transform active:scale-95 transition-all flex items-center gap-2"
              >
                <Save size={20} />
                Save Recipe
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------- CONFIRM DELETE MODAL -------------------- */}
      <ConfirmModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete Recipe?"
        description="Are you sure you want to delete this recipe? It will be removed from all categories."
        onConfirm={() => {
          if (confirmDeleteId) {
            setDishes(dishes.filter(d => d.id !== confirmDeleteId));
            setConfirmDeleteId(null);
          }
        }}
      />
    </div>
  );
};
