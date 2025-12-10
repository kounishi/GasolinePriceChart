// app/page.tsx

'use client';

import { useEffect, useState } from 'react';
import type { PriceState, Section } from '@/lib/types';

type ApiState =
  | { loading: true; state: null }
  | { loading: false; state: PriceState | null };

// 調査日を yyyy/M/d 形式に整形（例: 2025/3/3）
function formatSurveyDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    return dateStr;
  }
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}/${m}/${day}`;
}

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
        const res = await fetch('/api/prices', {
          cache: 'no-store', // ブラウザキャッシュを無効化
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
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
      const res = await fetch('/api/update-prices', { 
        method: 'POST',
        cache: 'no-store', // キャッシュを無効化
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
      // レスポンスがJSONかどうかを確認
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('サーバーからの応答が不正です。タイムアウトの可能性があります。');
      }
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '更新に失敗しました');
      }
      // メッセージが指定されている場合はそれを使用、なければlatestに基づいて表示
      // ボタン押下時のメッセージを常に統一
      setMessage('データは最新です');
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
          {updating ? '更新中…' : '更新（資源エネルギー庁サイトの最新調査データの読込）'}
        </button>

        <button
          onClick={handleDownload}
          className="px-4 py-2 rounded bg-blue-600 text-white"
        >
          価格比較表のダウンロード
        </button>
      </div>

      {/* ステータス表示（メッセージ＋最終更新を1行で表示） */}
      {!apiState.loading && (state || message) && (
        <div className="bg-blue-100 border border-blue-300 rounded px-4 py-2 text-sm text-blue-800">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            {message && <span>{message}</span>}
            {state && (
              <span>
                最終更新: {new Date(state.updatedAt).toLocaleString()} / 直近調査日:{' '}
                {formatSurveyDate(state.lastSurveyDate)}
              </span>
            )}
          </div>
        </div>
      )}

      {apiState.loading && (
        <div className="bg-blue-100 border border-blue-300 rounded px-4 py-2 text-sm text-blue-800">
          読込中...
        </div>
      )}

      {state && (
        <div className="space-y-8">
          {groupSectionsByFuel(state.sections).map((fuelGroup) => (
            <FuelGroupTable key={fuelGroup.fuel} fuelGroup={fuelGroup} />
          ))}
        </div>
      )}

      {!apiState.loading && !state && (
        <div className="bg-blue-100 border border-blue-300 rounded px-4 py-2 text-sm text-blue-800">
          まだ一度も更新されていません。「更新」を押してデータを取得してください。
        </div>
      )}
    </main>
  );
}

// セクションを燃料ごとにグループ化し、さらに地方を統合
type FuelGroup = {
  fuel: 'regular' | 'high' | 'diesel';
  groups: Array<{
    title: string;
    sections: Section[];
  }>;
};

function groupSectionsByFuel(sections: Section[]): FuelGroup[] {
  const fuelGroups: FuelGroup[] = [];
  const fuels: Array<'regular' | 'high' | 'diesel'> = ['regular', 'high', 'diesel'];

  for (const fuel of fuels) {
    const fuelSections = sections.filter((s) => s.fuel === fuel);
    if (fuelSections.length === 0) continue;

    const groups: Array<{ title: string; sections: Section[] }> = [];

    // 北海道・東北をまとめる
    const hokkaidoSection = fuelSections.find((s) => s.region === 'hokkaido');
    const tohokuSection = fuelSections.find((s) => s.region === 'tohoku');
    if (hokkaidoSection || tohokuSection) {
      groups.push({
        title: '北海道・東北',
        sections: [hokkaidoSection, tohokuSection].filter(Boolean) as Section[],
      });
    }

    // 関東
    const kantoSection = fuelSections.find((s) => s.region === 'kanto');
    if (kantoSection) {
      groups.push({
        title: '関東',
        sections: [kantoSection],
      });
    }

    // 中部
    const chubuSection = fuelSections.find((s) => s.region === 'chubu');
    if (chubuSection) {
      groups.push({
        title: '中部',
        sections: [chubuSection],
      });
    }

    // 近畿
    const kinkiSection = fuelSections.find((s) => s.region === 'kinki');
    if (kinkiSection) {
      groups.push({
        title: '近畿',
        sections: [kinkiSection],
      });
    }

    // 中国・四国をまとめる
    const chugokuSection = fuelSections.find((s) => s.region === 'chugoku');
    const shikokuSection = fuelSections.find((s) => s.region === 'shikoku');
    if (chugokuSection || shikokuSection) {
      groups.push({
        title: '中国・四国',
        sections: [chugokuSection, shikokuSection].filter(Boolean) as Section[],
      });
    }

    // 九州・沖縄をまとめる
    const kyushuSection = fuelSections.find((s) => s.region === 'kyushu');
    const okinawaSection = fuelSections.find((s) => s.region === 'okinawa');
    if (kyushuSection || okinawaSection) {
      groups.push({
        title: '九州・沖縄',
        sections: [kyushuSection, okinawaSection].filter(Boolean) as Section[],
      });
    }

    if (groups.length > 0) {
      fuelGroups.push({ fuel, groups });
    }
  }

  return fuelGroups;
}

// 燃料ごとのグループテーブル
function FuelGroupTable({ fuelGroup }: { fuelGroup: FuelGroup }) {
  const fuelName =
    fuelGroup.fuel === 'regular'
      ? 'レギュラー'
      : fuelGroup.fuel === 'high'
      ? 'ハイオク'
      : '軽油';

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">{fuelName}</h1>
      {fuelGroup.groups.map((group, idx) => (
        <GroupedSectionTable key={idx} title={group.title} sections={group.sections} />
      ))}
    </div>
  );
}

// 複数のセクションをまとめて表示するテーブル
function GroupedSectionTable({
  title,
  sections,
}: {
  title: string;
  sections: Section[];
}) {
  if (sections.length === 0) return null;

  // 最初のセクションの調査日と全国データを使用（すべて同じはず）
  const firstSection = sections[0];
  const { surveyDates, national } = firstSection;

  // すべての都道府県データを結合
  const allRows = sections.flatMap((s) => s.rows);
  const prefectures = allRows.map((r) => r.prefecture);

  return (
    <div className="border rounded p-3">
      <h2 className="font-semibold mb-2 text-sm">{title}</h2>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="border px-3 py-2">調査日</th>
              <th className="border px-3 py-2">全国</th>
              {prefectures.map((p) => (
                <th key={p} className="border px-3 py-2">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {surveyDates.map((date, i) => (
              <tr key={i}>
                <td className="border px-3 py-2 whitespace-nowrap">
                  {formatSurveyDate(date)}
                </td>
                <td className="border px-3 py-2 text-right">
                  {national[i]?.toFixed(1)}
                </td>
                {allRows.map((r) => {
                  const v = r.prices[i] ?? 0;
                  const high = !isNaN(v) && v > (national[i] ?? 0);
                  return (
                    <td
                      key={r.prefecture + i}
                      className={`border px-3 py-2 text-right ${
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

