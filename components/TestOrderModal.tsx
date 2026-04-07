import React, { useState, useEffect } from 'react';
import { Dish, PriorityLevel } from '../types';
import { Zap, Plus, Trash2, Send } from 'lucide-react';

interface TestOrderModalProps {
  dishes: Dish[];
  onClose: () => void;
  onAddOrder: (items: { dishId: string; priority: PriorityLevel; quantity: number }[], tableNumber?: number) => void;
}

export const TestOrderModal: React.FC<TestOrderModalProps> = ({ dishes, onClose, onAddOrder }) => {
  const [testTableInput, setTestTableInput] = useState('');
  const [testDishId, setTestDishId] = useState<string>('');
  const [testPriority, setTestPriority] = useState<PriorityLevel>(PriorityLevel.NORMAL);
  const [testQty, setTestQty] = useState<number>(1);
  const [testTicketItems, setTestTicketItems] = useState<{ dishId: string; priority: PriorityLevel; quantity: number }[]>([]);

  // Инициализация выбора блюда при первой загрузке
  useEffect(() => {
    if (dishes.length > 0 && !testDishId) {
      setTestDishId(dishes[0].id);
      setTestPriority(dishes[0].priority_flag);
    }
  }, [dishes, testDishId]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100]">
      <div className="bg-kds-card p-6 rounded-lg w-[32rem] border border-slate-700 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-6 flex items-center border-b border-slate-800 pb-4">
          <Zap className="mr-2 text-yellow-400" /> Simulate Waiter Terminal
        </h3>

        <div className="space-y-4">
          {/* Ticket Header (Table Number) */}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Table Number</label>
            <input
              type="number"
              placeholder="Enter Table #"
              value={testTableInput}
              onChange={(e) => setTestTableInput(e.target.value)}
              className="w-full bg-slate-900 text-white p-3 rounded border border-slate-700 outline-none focus:border-blue-500 transition-colors font-mono text-xl font-bold"
            />
          </div>

          {/* Item Selection */}
          <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
            <div className="flex gap-4 mb-4">
              <div className="flex-1">
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Dish</label>
                <select
                  className="w-full bg-slate-900 text-white p-2 rounded border border-slate-700 outline-none focus:border-blue-500"
                  value={testDishId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setTestDishId(newId);
                    const d = dishes.find(dish => dish.id === newId);
                    if (d) setTestPriority(d.priority_flag);
                  }}
                >
                  {dishes.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="w-20">
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Qty</label>
                <input
                  type="number"
                  min="1"
                  className="w-full bg-slate-900 text-white p-2 rounded border border-slate-700 outline-none focus:border-blue-500 text-center"
                  value={testQty}
                  onChange={(e) => setTestQty(parseInt(e.target.value) || 1)}
                />
              </div>
              <div className="w-1/3">
                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Priority</label>
                <select
                  className="w-full bg-slate-900 text-white p-2 rounded border border-slate-700 outline-none focus:border-blue-500"
                  value={testPriority}
                  onChange={(e) => setTestPriority(parseInt(e.target.value))}
                >
                  <option value={PriorityLevel.NORMAL}>Normal</option>
                  <option value={PriorityLevel.ULTRA}>🚨 ULTRA</option>
                </select>
              </div>
            </div>
            <button
              onClick={() => {
                if (!testDishId) return;

                setTestTicketItems(prev => {
                  // Check for duplicate dish (same id + same priority) to auto-aggregate in ticket view
                  const existingIndex = prev.findIndex(i => i.dishId === testDishId && i.priority === testPriority);
                  if (existingIndex > -1) {
                    const updated = [...prev];
                    updated[existingIndex].quantity += testQty;
                    return updated;
                  }
                  return [...prev, { dishId: testDishId, priority: testPriority, quantity: testQty }];
                });
              }}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 rounded transition-colors text-sm flex items-center justify-center"
            >
              <Plus size={16} className="mr-2" /> Add Selection to Ticket
            </button>
          </div>

          {/* Current Ticket Preview */}
          <div className="min-h-[150px] max-h-[250px] overflow-y-auto bg-white/5 rounded border border-slate-700 p-2">
            {testTicketItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50">
                <span className="text-4xl mb-2">🧾</span>
                <span className="text-sm">Ticket is empty</span>
              </div>
            ) : (
              <div className="space-y-1">
                {testTicketItems.map((item, idx) => {
                  const d = dishes.find(x => x.id === item.dishId);
                  return (
                    <div key={idx} className="flex items-center justify-between bg-black/20 p-2 rounded text-sm">
                      <div className="flex items-center">
                        <div className="font-mono bg-slate-900 text-slate-300 w-8 h-8 flex items-center justify-center rounded mr-3 text-xs font-bold">
                          {item.quantity}x
                        </div>
                        <div>
                          <div className={item.priority === PriorityLevel.ULTRA ? 'text-red-400 font-bold' : 'text-gray-300'}>
                            {d?.name || 'Unknown'}
                          </div>
                          {item.priority === PriorityLevel.ULTRA && <span className="text-[10px] bg-red-900 text-red-100 px-1 rounded inline-block mt-0.5">ULTRA</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => setTestTicketItems(prev => prev.filter((_, i) => i !== idx))}
                        className="text-slate-500 hover:text-red-400 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-700">
            <button
              onClick={() => {
                const tableNum = testTableInput ? parseInt(testTableInput) : undefined;
                onAddOrder(testTicketItems, tableNum);
              }}
              disabled={testTicketItems.length === 0}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded transition-colors flex items-center justify-center"
            >
              <Send size={20} className="mr-2" /> Send Order to Kitchen
            </button>
            <button
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded transition-colors border border-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
