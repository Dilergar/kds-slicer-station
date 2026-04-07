import React, { useState } from 'react';
import { Category } from '../../types';
import { Plus, Save, X, Edit2, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { ConfirmModal } from '../ui/ConfirmModal';

interface CategoriesTabProps {
  categories: Category[];
  setCategories: (cats: Category[]) => void;
}

export const CategoriesTab: React.FC<CategoriesTabProps> = ({ categories, setCategories }) => {
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [tempCategoryName, setTempCategoryName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const moveCategory = (index: number, direction: 'UP' | 'DOWN') => {
    if ((direction === 'UP' && index === 0) || (direction === 'DOWN' && index === categories.length - 1)) return;

    const newCats = [...categories];
    const swapIndex = direction === 'UP' ? index - 1 : index + 1;

    // Swap Sort Indices visually and logic wise
    const tempIndex = newCats[index].sort_index;
    newCats[index].sort_index = newCats[swapIndex].sort_index;
    newCats[swapIndex].sort_index = tempIndex;

    // Swap position in array
    [newCats[index], newCats[swapIndex]] = [newCats[swapIndex], newCats[index]];

    setCategories(newCats);
  };

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    const newId = `c_${Date.now()}`;
    const maxSortIndex = Math.max(...categories.map(c => c.sort_index), 0);
    const newCategory: Category = {
      id: newId,
      name: newCategoryName.trim(),
      sort_index: maxSortIndex + 1
    };
    setCategories([...categories, newCategory]);
    setNewCategoryName('');
    setIsAddingCategory(false);
  };

  const handleDeleteCategory = (id: string) => {
    setConfirmDeleteId(id);
  };

  const initiateEditCategory = (cat: Category) => {
    setEditingCategoryId(cat.id);
    setTempCategoryName(cat.name);
  };

  const saveCategory = () => {
    if (!tempCategoryName.trim()) return;
    setCategories(categories.map(c => c.id === editingCategoryId ? { ...c, name: tempCategoryName } : c));
    setEditingCategoryId(null);
  };

  return (
    <div className="bg-kds-card rounded-lg p-6 max-w-2xl border border-gray-800">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-2">Menu Categories</h2>
          <p className="text-sm text-gray-400">Use arrows to adjust category priority on the KDS screen.</p>
        </div>
        <button
          onClick={() => setIsAddingCategory(true)}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-500 flex items-center gap-1 font-bold shadow-lg shadow-blue-900/20"
        >
          <Plus size={16} /> Add Category
        </button>
      </div>

      {isAddingCategory && (
        <div className="bg-gray-800/80 p-3 rounded-lg border border-blue-500/50 mb-6 flex items-center gap-2 shadow-lg shadow-blue-900/10 backdrop-blur-sm">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New Category Name"
            className="bg-gray-900 text-white px-3 py-2 rounded flex-1 outline-none border border-gray-700/50 focus:border-blue-500/50 focus:ring-1 ring-blue-500/50 transition-all"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
          />
          <button onClick={handleAddCategory} className="text-green-500 hover:text-green-400 p-2 transition-colors"><Save size={20} /></button>
          <button onClick={() => setIsAddingCategory(false)} className="text-red-500 hover:text-red-400 p-2 transition-colors"><X size={20} /></button>
        </div>
      )}

      <ul className="space-y-3">
        {categories.map((cat, index) => (
          <li key={cat.id} className="flex items-center justify-between bg-gray-800/50 hover:bg-gray-800/80 p-3 rounded-lg border border-gray-700/50 transition-colors group">
            <div className="flex items-center gap-4 flex-1">
              <span className="bg-gray-900 text-gray-400 text-xs px-2 py-1 rounded font-mono font-bold border border-gray-800">#{cat.sort_index}</span>

              {editingCategoryId === cat.id ? (
                <div className="flex items-center gap-2 flex-1 mr-4">
                  <input
                    type="text"
                    value={tempCategoryName}
                    onChange={(e) => setTempCategoryName(e.target.value)}
                    className="bg-gray-900 text-white px-3 py-1.5 rounded flex-1 outline-none border border-blue-500/50 focus:ring-1 ring-blue-500/50 transition-all font-medium"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && saveCategory()}
                  />
                  <button onClick={saveCategory} className="text-green-500 hover:text-green-400"><Save size={18} /></button>
                  <button onClick={() => setEditingCategoryId(null)} className="text-red-500 hover:text-red-400"><X size={18} /></button>
                </div>
              ) : (
                <span className="text-gray-200 font-bold flex-1 text-lg uppercase tracking-wider">{cat.name}</span>
              )}
            </div>

            <div className="flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
              {!editingCategoryId && (
                <>
                  <button
                    onClick={() => initiateEditCategory(cat)}
                    className="p-2 hover:bg-blue-600/20 rounded-md text-gray-400 hover:text-blue-400 transition-colors"
                    title="Edit Name"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(cat.id)}
                    className="p-2 hover:bg-red-900/30 rounded-md text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete Category"
                  >
                    <Trash2 size={18} />
                  </button>
                  <div className="w-px h-6 bg-gray-700 mx-1"></div>
                </>
              )}

              <button
                onClick={() => moveCategory(index, 'UP')}
                disabled={index === 0}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md disabled:opacity-30 disabled:hover:bg-gray-700 text-white transition-colors"
              >
                <ArrowUp size={16} />
              </button>
              <button
                onClick={() => moveCategory(index, 'DOWN')}
                disabled={index === categories.length - 1}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-md disabled:opacity-30 disabled:hover:bg-gray-700 text-white transition-colors"
              >
                <ArrowDown size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete Category?"
        description="Are you sure you want to delete this category? Dishes associated with this category might become orphaned or unsortable."
        onConfirm={() => {
          if (confirmDeleteId) {
            setCategories(categories.filter(c => c.id !== confirmDeleteId));
            setConfirmDeleteId(null);
          }
        }}
      />
    </div>
  );
};
