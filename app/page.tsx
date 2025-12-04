// app/page.tsx

'use client';

import { useEffect, useState } from 'react';
import type { PriceState, Section } from '@/lib/types';

type ApiState =
  | { loading: true; state: null }
  | { loading: false; state: PriceState | null };

export default function Page() {
  const [apiState, setApiState] = useState<ApiState>({
    loading: true,
    state: null,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  // 初期表示：KVから現在のstateだけ取得
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/prices');
        const data = await res.json();
        setApiState({ loading: false, state: data.state ?? null });
      } catch {
        setApiState({ loading: false, state: null });
      }
    })();
  }, []);

  const state = apiState.state;

  const handleUpdate = async () => {
    setUpdating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/update-prices', { method: 'POST' });
      
      // レスポンスがJSONかどうかを確認
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('サーバーからの応答が不正です。タイムアウトの可能性があります。');
      }
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '更新に失敗しました');
      }
      if (data.latest) {
        setMessage('データは最新です');
      } else {
        setMessage('最新データを取得しました');
      }
      setApiState({ loading: false, state: data.state });
    } catch (e: any) {
      // JSONパースエラーの場合
      if (e instanceof SyntaxError) {
        setMessage('サーバーからの応答が不正です。タイムアウトの可能性があります。Cronジョブによる自動更新を待つか、しばらく時間をおいてから再度お試しください。');
      } else {
        let errorMessage = e.message || '更新に失敗しました';
        // タイムアウトエラーの場合、Cronジョブについても言及
        if (errorMessage.includes('タイムアウト')) {
          errorMessage += ' Cronジョブによる自動更新（毎日午前9時）を待つか、しばらく時間をおいてから再度お試しください。';
        }
        setMessage(errorMessage);
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleDownload = () => {
    window.location.href = '/api/download-prices';
  };

  return (
    <main className="p-6 space-y-4">
      <div className="space-x-3">
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
        >
          {updating ? '更新中…' : '更新（資源エネルギー庁データの読込）'}
        </button>

        <button
          onClick={handleDownload}
          className="px-4 py-2 rounded bg-blue-600 text-white"
        >
          価格表ダウンロード
        </button>
      </div>

      {message && <p className="text-sm text-gray-700">{message}</p>}

      {apiState.loading && <p>読込中...</p>}

      {state && (
        <div className="space-y-8">
          <p className="text-sm text-gray-600">
            最終更新: {new Date(state.updatedAt).toLocaleString()} / 直近調査日:{' '}
            {state.lastSurveyDate}
          </p>

          {state.sections.map((section) => (
            <SectionTable key={section.id} section={section} />
          ))}
        </div>
      )}

      {!apiState.loading && !state && (
        <p className="text-sm text-gray-600">
          まだ一度も更新されていません。「更新」を押してデータを取得してください。
        </p>
      )}
    </main>
  );
}

// テンプレと同じイメージで、行=調査日、列=全国・都道府県 の表を表示
function SectionTable({ section }: { section: Section }) {
  const { title, surveyDates, national, rows } = section;

  const prefectures = rows.map((r) => r.prefecture);

  return (
    <div className="border rounded p-3">
      <h2 className="font-semibold mb-2 text-sm">{title}</h2>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="border px-2 py-1">調査日</th>
              <th className="border px-2 py-1">全国</th>
              {prefectures.map((p) => (
                <th key={p} className="border px-2 py-1">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {surveyDates.map((date, i) => (
              <tr key={i}>
                <td className="border px-2 py-1 whitespace-nowrap">{date}</td>
                <td className="border px-2 py-1 text-right">
                  {national[i]?.toFixed(1)}
                </td>
                {rows.map((r) => {
                  const v = r.prices[i] ?? 0;
                  const high = !isNaN(v) && v > (national[i] ?? 0);
                  return (
                    <td
                      key={r.prefecture + i}
                      className={`border px-2 py-1 text-right ${
                        high ? 'bg-red-200' : ''
                      }`}
                    >
                      {v ? v.toFixed(1) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

