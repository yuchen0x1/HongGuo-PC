import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSearchText, rankSearchResults, mergeDuplicateDramas } from '../searchRanking.mjs';

test('normalization ignores width, spaces and punctuation', () => {
  assert.equal(normalizeSearchText('言出法随，诸天万界 我说了算'), '言出法随诸天万界我说了算');
  assert.equal(normalizeSearchText('  恶犬在身边！ '), '恶犬在身边');
  assert.equal(normalizeSearchText(null), '');
});

test('punctuation differences still rank as a title match', () => {
  const ranked = rankSearchResults([
    { source: 'hongguo', series_id: '1', series_title: '言出法随，诸天万界我说了算' },
    { source: 'hongguo', series_id: '2', series_title: '完全无关的剧' },
  ], '言出法随 诸天万界 我说了算');
  assert.equal(ranked[0].series_id, '1');
  assert.equal(ranked[0].relevance, 0);
  assert.equal(ranked[1].relevance, 3);
});

test('partial titles rank between exact and unrelated results', () => {
  const ranked = rankSearchResults([
    { source: 'hongguo', series_id: '1', series_title: '别的剧' },
    { source: 'hongguo', series_id: '2', series_title: '恶犬在身边' },
    { source: 'hongguo', series_id: '3', series_title: '恶犬' },
  ], '恶犬');
  assert.deepEqual(ranked.map(item => item.series_id), ['3', '2', '1']);
  assert.deepEqual(ranked.map(item => item.relevance), [0, 1, 3]);
});

test('duplicates are dropped per source and missing titles are ignored', () => {
  const ranked = rankSearchResults([
    { source: 'hongguo', series_id: '1', series_title: '同名剧' },
    { source: 'hongguo', series_id: '1', series_title: '同名剧' },
    { source: 'hema', series_id: '9', series_title: '同名剧', episode_count: 80 },
    { source: 'hongguo', series_id: '2' },
  ], '同名剧');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].source, 'hongguo');
  assert.deepEqual(ranked[0].also_on, [{ source: 'hema', series_id: '9' }]);
});

test('cross-source same drama merges into one entry and counts reported duplicates', () => {
  const ranked = rankSearchResults([
    { source: 'hema', series_id: '8', series_title: '闪婚后，傅总马甲藏不住了', episode_count: 66 },
    { source: 'hongguo', series_id: '100', series_title: '闪婚后，傅总马甲藏不住了！', episode_count: 66 },
    { source: 'xifan', series_id: '200:1', series_title: '闪婚后傅总马甲藏不住了', episode_count: 64 },
  ], '闪婚后，傅总马甲藏不住了');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].source, 'hema');
  assert.equal(ranked[0].also_on.length, 2);
  const mergedCount = ranked.reduce((total, item) => total + (item.also_on?.length || 0), 0);
  assert.equal(mergedCount, 2);
});

test('same title with far different episode counts stays separate', () => {
  const merged = mergeDuplicateDramas([
    { source: 'hongguo', series_id: '1', series_title: '同名剧', episode_count: 30 },
    { source: 'xifan', series_id: '2', series_title: '同名剧', episode_count: 90 },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(item => item.also_on.length), [0, 0]);
});

test('same-source same-title results with different IDs stay independently selectable', () => {
  const ranked = rankSearchResults([
    { source: 'hongguo', series_id: '1', series_title: '同名剧', episode_count: 80 },
    { source: 'hongguo', series_id: '2', series_title: '同名剧', episode_count: 80 },
    { source: 'hema', series_id: '9', series_title: '同名剧', episode_count: 80 },
  ], '同名剧');
  assert.deepEqual(ranked.map(item => item.series_id), ['1', '2']);
  assert.deepEqual(ranked[0].also_on, [{ source: 'hema', series_id: '9' }]);
  assert.deepEqual(ranked[1].also_on, []);
});

test('unknown episode counts still merge across sources', () => {
  const merged = mergeDuplicateDramas([
    { source: 'hongguo', series_id: '1', series_title: '无名剧' },
    { source: 'xifan', series_id: '2', series_title: '无名剧', episode_count: 0 },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].also_on, [{ source: 'xifan', series_id: '2' }]);
});

test('punctuation differences still count as the same drama when merging', () => {
  const merged = mergeDuplicateDramas([
    { source: 'hongguo', series_id: '1', series_title: '恶犬在身边！' },
    { source: 'hema', series_id: '2', series_title: '恶 犬 在 身 边', episode_count: 55 },
  ]);
  assert.equal(merged.length, 1);
});

test('fuzzy results sort before unrelated results but after title matches', () => {
  const ranked = rankSearchResults([
    { source: 'hongguo', series_id: '1', series_title: '完全无关的剧' },
    { source: 'hongguo', series_id: '2', series_title: '补搜到的剧', fuzzy: true },
    { source: 'hongguo', series_id: '3', series_title: '目标剧名' },
  ], '目标剧名');
  assert.deepEqual(ranked.map(item => item.series_id), ['3', '2', '1']);
  assert.equal(ranked[1].relevance, 3);
  assert.equal(ranked[1].fuzzy, true);
});


test('content matches rank after title matches but before unrelated results', () => {
  const ranked = rankSearchResults([
    { source: 'hongguo', series_id: '1', series_title: '完全无关的剧' },
    { source: 'hongguo', series_id: '2', series_title: '工地前的一碗盒饭', series_intro: '这道菜吃了不烧心，工友都喜欢。' },
    { source: 'hongguo', series_id: '3', series_title: '不烧心的烧烤摊' },
  ], '烧心');
  assert.deepEqual(ranked.map(item => item.series_id), ['3', '2', '1']);
  assert.deepEqual(ranked.map(item => item.relevance), [1, 2, 3]);
  assert.equal(ranked[1].contentMatch, true);
});

test('App new-release reverse matches rank as title matches', () => {
  const ranked = rankSearchResults([
    { source: 'hongguo', series_id: '1', series_title: '完全无关的剧' },
    { source: 'hongguo', series_id: '2', series_title: '闪婚', new_release: true },
    { source: 'hongguo', series_id: '3', series_title: '别的剧', series_intro: '我想看闪婚' },
  ], '我想看闪婚');
  assert.deepEqual(ranked.map(item => item.series_id), ['2', '3', '1']);
  assert.equal(ranked[0].relevance, 1);
  assert.equal(ranked[1].relevance, 2);
});
