import {
  ListTodo,
  Clock,
  Sparkles,
  Activity,
  CheckCircle2,
  Info,
  X
} from 'lucide-react';

export interface TaskCountsData {
  total_tasks: number;
  pending_tasks: number | 'N/A';
  pending_is_na: boolean;
  just_started_tasks: number;
  in_progress_tasks: number;
  completed_tasks: number;
  matching_task_ids?: {
    total: string[];
    pending: string[];
    just_started: string[];
    in_progress: string[];
    completed: string[];
  };
}

export type TaskCountFilterKey = 'total' | 'pending' | 'just_started' | 'in_progress' | 'completed';

interface TaskCountSummaryCardsProps {
  taskCounts?: TaskCountsData | null;
  activeFilter: TaskCountFilterKey | null;
  onSelectFilter: (key: TaskCountFilterKey | null) => void;
  isLoading?: boolean;
  error?: string | null;
  contextLabel?: string; // e.g. "for selected date" or "for 10:00 AM–11:00 AM"
}

export default function TaskCountSummaryCards({
  taskCounts,
  activeFilter,
  onSelectFilter,
  isLoading = false,
  error = null,
  contextLabel = 'matching active filters'
}: TaskCountSummaryCardsProps) {
  if (error) {
    return (
      <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
        <Info size={16} className="text-rose-600 shrink-0" />
        <span>Failed to calculate task counts: {error}</span>
      </div>
    );
  }

  const handleCardClick = (key: TaskCountFilterKey) => {
    if (isLoading) return;
    if (key === 'pending' && taskCounts?.pending_is_na) return;
    if (activeFilter === key) {
      onSelectFilter(null);
    } else {
      onSelectFilter(key);
    }
  };

  const cards = [
    {
      key: 'total' as TaskCountFilterKey,
      title: 'Total Tasks',
      value: taskCounts?.total_tasks ?? 0,
      isNa: false,
      badge: 'Lifecycle Total',
      badgeColor: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      subtitle: 'Distinct tasks matching active filters',
      formula: 'Pending + In Progress + Completed',
      icon: ListTodo,
      borderColor: 'border-indigo-200/80',
      activeRing: 'ring-2 ring-indigo-500 shadow-md bg-indigo-50/50',
      hoverBorder: 'hover:border-indigo-300',
      iconColor: 'text-indigo-600',
      textColor: 'text-slate-900',
      clickable: true
    },
    {
      key: 'pending' as TaskCountFilterKey,
      title: 'Pending Tasks',
      value: taskCounts?.pending_is_na ? 'N/A' : (taskCounts?.pending_tasks ?? 0),
      isNa: Boolean(taskCounts?.pending_is_na),
      badge: 'Not Started',
      badgeColor: 'bg-amber-100 text-amber-700 border-amber-200',
      subtitle: taskCounts?.pending_is_na
        ? 'Hourly slot: scheduling unavailable'
        : 'Tasks not yet started on date',
      formula: 'No work session recorded yet',
      icon: Clock,
      borderColor: 'border-amber-200/80',
      activeRing: 'ring-2 ring-amber-500 shadow-md bg-amber-50/50',
      hoverBorder: taskCounts?.pending_is_na ? '' : 'hover:border-amber-300',
      iconColor: 'text-amber-600',
      textColor: taskCounts?.pending_is_na ? 'text-slate-400 font-sans' : 'text-slate-900',
      clickable: !taskCounts?.pending_is_na
    },
    {
      key: 'just_started' as TaskCountFilterKey,
      title: 'Just Started Tasks',
      value: taskCounts?.just_started_tasks ?? 0,
      isNa: false,
      badge: 'Activity',
      badgeColor: 'bg-purple-100 text-purple-700 border-purple-200',
      subtitle: 'First-ever start during period',
      formula: 'Activity metric (may overlap status)',
      icon: Sparkles,
      borderColor: 'border-purple-200/80',
      activeRing: 'ring-2 ring-purple-500 shadow-md bg-purple-50/50',
      hoverBorder: 'hover:border-purple-300',
      iconColor: 'text-purple-600',
      textColor: 'text-purple-900',
      clickable: true
    },
    {
      key: 'in_progress' as TaskCountFilterKey,
      title: 'In Progress Tasks',
      value: taskCounts?.in_progress_tasks ?? 0,
      isNa: false,
      badge: 'Active / Paused',
      badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
      subtitle: 'Started and not yet completed',
      formula: 'Work ongoing in period',
      icon: Activity,
      borderColor: 'border-blue-200/80',
      activeRing: 'ring-2 ring-blue-500 shadow-md bg-blue-50/50',
      hoverBorder: 'hover:border-blue-300',
      iconColor: 'text-blue-600',
      textColor: 'text-blue-900',
      clickable: true
    },
    {
      key: 'completed' as TaskCountFilterKey,
      title: 'Completed Tasks',
      value: taskCounts?.completed_tasks ?? 0,
      isNa: false,
      badge: 'Finished',
      badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      subtitle: 'Explicitly marked completed',
      formula: 'Completed timestamp in period',
      icon: CheckCircle2,
      borderColor: 'border-emerald-200/80',
      activeRing: 'ring-2 ring-emerald-500 shadow-md bg-emerald-50/50',
      hoverBorder: 'hover:border-emerald-300',
      iconColor: 'text-emerald-600',
      textColor: 'text-emerald-800',
      clickable: true
    }
  ];

  return (
    <div className="space-y-2.5">
      {/* Active Filter Pill Bar if a card filter is selected */}
      {activeFilter && (
        <div className="flex items-center justify-between px-3.5 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200/80 text-xs text-indigo-900 animate-in fade-in">
          <div className="flex items-center gap-2">
            <span className="font-bold">Active Card Filter:</span>
            <span className="clay-pill px-2 py-0.5 text-[11px] font-bold bg-white text-indigo-700 shadow-2xs border border-indigo-200">
              {cards.find((c) => c.key === activeFilter)?.title}
            </span>
            <span className="text-slate-500 text-[11px]">
              Showing matching tasks only ({contextLabel})
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectFilter(null)}
            className="flex items-center gap-1 font-bold text-indigo-700 hover:text-indigo-900 underline text-xs"
          >
            <X size={13} />
            <span>Show All Tasks</span>
          </button>
        </div>
      )}

      {/* 5-Card Responsive Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-3.5">
        {cards.map((card) => {
          const isSelected = activeFilter === card.key;
          const IconComp = card.icon;

          return (
            <div
              key={card.key}
              onClick={() => card.clickable && handleCardClick(card.key)}
              role="button"
              tabIndex={card.clickable ? 0 : -1}
              onKeyDown={(e) => {
                if (card.clickable && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleCardClick(card.key);
                }
              }}
              title={
                card.isNa
                  ? 'Pending tasks have no work session; hourly scheduling is unavailable'
                  : `Click to filter task table by ${card.title}`
              }
              className={`p-3.5 sm:p-4 rounded-2xl border transition-all text-left flex flex-col justify-between select-none relative ${
                card.clickable ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default opacity-85'
              } ${card.borderColor} ${card.hoverBorder} ${
                isSelected ? card.activeRing : 'bg-white shadow-2xs hover:shadow-xs'
              }`}
            >
              {/* Header row: Title + Icon */}
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 line-clamp-1">
                    {card.title}
                  </span>
                  <div className={`p-1.5 rounded-lg bg-slate-50 shrink-0 ${card.iconColor}`}>
                    <IconComp size={15} />
                  </div>
                </div>

                {/* Main Count Display */}
                <div className="mt-1 flex items-baseline gap-1.5">
                  {isLoading ? (
                    <div className="h-7 w-14 bg-slate-200 animate-pulse rounded-md" />
                  ) : (
                    <span className={`text-2xl sm:text-2xl font-black font-mono tracking-tight ${card.textColor}`}>
                      {card.value}
                    </span>
                  )}

                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                </div>
              </div>

              {/* Subtitle & Formula hint */}
              <div className="mt-2.5 pt-2 border-t border-slate-100/90">
                <p className="text-[10px] text-slate-500 font-medium leading-tight">
                  {card.subtitle}
                </p>
                <p className="text-[9px] text-slate-400 mt-0.5 font-mono truncate" title={card.formula}>
                  {card.formula}
                </p>
              </div>

              {/* Selection indicator pill */}
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-600 inline-block animate-ping" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
