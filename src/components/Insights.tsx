import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Sparkles, BookOpenCheck, Users, Globe, Calendar, FileText } from 'lucide-react';
import type { Book } from '../types';
import {
  breakdownAuthors,
  breakdownCategories,
  breakdownDecades,
  breakdownLanguages,
  computeStats,
  generateInsights,
  langName,
} from '../lib/insights';
import { t, type Lang } from '../lib/i18n';

const PIE_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee'];

interface InsightsProps {
  books: Book[];
  lang: Lang;
}

export function Insights({ books, lang }: InsightsProps) {
  const stats = useMemo(() => computeStats(books), [books]);
  const authors = useMemo(() => breakdownAuthors(books), [books]);
  const categories = useMemo(() => breakdownCategories(books), [books]);
  const languages = useMemo(
    () => breakdownLanguages(books).map((b) => ({ ...b, label: langName(b.label) })),
    [books],
  );
  const decades = useMemo(() => breakdownDecades(books), [books]);
  const insights = useMemo(() => generateInsights(books), [books]);

  if (!books.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center animate-fade-in">
        <Sparkles className="h-12 w-12 text-accent-400" />
        <h2 className="text-xl font-bold text-white">{t(lang, 'insights.empty.title')}</h2>
        <p className="max-w-xs text-sm text-slate-400">{t(lang, 'insights.empty.body')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <h2 className="text-2xl font-bold text-white">{t(lang, 'tab.insights')}</h2>

      {insights.length > 0 && (
        <section className="flex flex-col gap-3">
          {insights.map((ins, i) => {
            const toneClass =
              ins.tone === 'good'
                ? 'from-emerald-500/15 to-emerald-500/5 ring-emerald-400/20'
                : ins.tone === 'warn'
                  ? 'from-amber-500/15 to-amber-500/5 ring-amber-400/20'
                  : 'from-accent-500/15 to-accent-500/5 ring-accent-400/20';
            return (
              <div
                key={i}
                className={`rounded-2xl bg-gradient-to-br p-4 ring-1 ring-inset ${toneClass}`}
              >
                <p className="text-sm font-semibold text-white">{ins.title}</p>
                <p className="mt-1 text-sm text-slate-300">{ins.body}</p>
              </div>
            );
          })}
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-slate-400">
          {t(lang, 'insights.stats')}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={<BookOpenCheck />} label={t(lang, 'insights.total')} value={stats.total} />
          <StatCard icon={<Users />} label={t(lang, 'insights.authors.label')} value={stats.uniqueAuthors} />
          <StatCard icon={<Globe />} label="🇮🇱 " value={stats.israeliCount} suffix={` / ${stats.total}`} />
          <StatCard icon={<FileText />} label={t(lang, 'insights.pages')} value={stats.totalPages} />
        </div>
      </section>

      {authors.length > 0 && (
        <ChartSection title={t(lang, 'insights.authors')}>
          <Bars data={authors} />
        </ChartSection>
      )}

      {categories.length > 0 && (
        <ChartSection title={t(lang, 'insights.categories')}>
          <Bars data={categories} />
        </ChartSection>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {languages.length > 0 && (
          <ChartSection title={t(lang, 'insights.languages')} icon={<Globe className="h-4 w-4" />}>
            <PieView data={languages} />
          </ChartSection>
        )}
        {decades.length > 0 && (
          <ChartSection title={t(lang, 'insights.decades')} icon={<Calendar className="h-4 w-4" />}>
            <Bars data={decades} />
          </ChartSection>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="card flex flex-col gap-2 !p-4">
      <span className="text-accent-400">{icon}</span>
      <span className="text-2xl font-bold text-white tabular-nums">
        {value.toLocaleString()}
        {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
      </span>
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
    </div>
  );
}

function ChartSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card !p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-accent-400">{icon}</span>}
        <h3 className="text-sm font-medium uppercase tracking-wider text-slate-300">{title}</h3>
      </div>
      <div className="h-52 w-full">{children}</div>
    </section>
  );
}

function Bars({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          axisLine={false}
          tickLine={false}
          width={110}
          tick={{ fill: '#cbd5e1', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'rgba(167,139,250,0.08)' }}
          contentStyle={{
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '0.75rem',
            color: '#e2e8f0',
            fontSize: 12,
          }}
        />
        <Bar dataKey="count" fill="#a78bfa" radius={[4, 4, 4, 4]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function PieView({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="label"
          innerRadius={45}
          outerRadius={75}
          paddingAngle={2}
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '0.75rem',
            color: '#e2e8f0',
            fontSize: 12,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
