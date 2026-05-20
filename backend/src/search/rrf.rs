use std::collections::HashMap;

use crate::types::search::SearchHit;

/// Reciprocal Rank Fusion (RRF)
///
/// 公式: score(d) = Σ_{r∈R} 1 / (k + rank_r(d) + 1)
///   R = {fts_results, vec_results}
///   rank 是 0-indexed
///
/// INPUT:  fts_results: FTS5 bm25() top-K (K=20)
///         vec_results: vec0 top-K (K=20)
///         k: RRF 常数 (60)
///
/// OUTPUT: Vec<SearchHit> 按 rrf_score DESC 排序, 截断至 top-5
pub fn reciprocal_rank_fusion(
    fts_results: Vec<SearchHit>,
    vec_results: Vec<SearchHit>,
    k: u32,
) -> Vec<SearchHit> {
    let mut scores: HashMap<i64, f64> = HashMap::new();
    let mut hit_map: HashMap<i64, SearchHit> = HashMap::new();

    for (rank, hit) in fts_results.iter().enumerate() {
        let score = 1.0 / (k as f64 + rank as f64 + 1.0);
        *scores.entry(hit.id).or_insert(0.0) += score;
        hit_map.entry(hit.id).or_insert_with(|| hit.clone());
    }

    for (rank, hit) in vec_results.iter().enumerate() {
        let score = 1.0 / (k as f64 + rank as f64 + 1.0);
        *scores.entry(hit.id).or_insert(0.0) += score;
        hit_map.entry(hit.id).or_insert_with(|| hit.clone());
    }

    let mut ranked: Vec<SearchHit> = hit_map
        .into_iter()
        .map(|(id, mut hit)| {
            hit.rrf_score = scores[&id];
            hit
        })
        .collect();

    ranked.sort_by(|a, b| b.rrf_score.partial_cmp(&a.rrf_score).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(5);
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_hit(id: i64, slug: &str) -> SearchHit {
        SearchHit {
            id,
            slug: slug.into(),
            title: format!("Title {}", slug),
            heading_text: format!("Heading {}", slug),
            slug_anchor: slug.into(),
            snippet: format!("snippet {}", slug),
            visibility: "public".into(),
            rrf_score: 0.0,
        }
    }

    #[test]
    fn test_rrf_fusion() {
        // FTS 命中: id 1, 2, 3
        let fts = vec![make_hit(1, "a"), make_hit(2, "b"), make_hit(3, "c")];

        // Vec 命中: id 2, 3, 4 (2,3 与 FTS 重叠)
        let vec = vec![make_hit(2, "b"), make_hit(3, "c"), make_hit(4, "d")];

        let result = reciprocal_rank_fusion(fts, vec, 60);

        // 结果 ≤ 5
        assert!(result.len() <= 5);

        // id 2 和 3（公共文档）应在 id 1 和 4 之前
        let ids: Vec<i64> = result.iter().map(|h| h.id).collect();
        let pos_2 = ids.iter().position(|&id| id == 2).unwrap();
        let pos_3 = ids.iter().position(|&id| id == 3).unwrap();
        let pos_1 = ids.iter().position(|&id| id == 1);
        let pos_4 = ids.iter().position(|&id| id == 4);

        // 公共文档得分应更高
        assert!(
            pos_2 < pos_1.unwrap_or(usize::MAX),
            "common doc 2 should rank above fts-only doc 1"
        );
        assert!(
            pos_3 < pos_4.unwrap_or(usize::MAX),
            "common doc 3 should rank above vec-only doc 4"
        );

        // id 2 在两列表中 rank 分别是 1 和 0
        // score = 1/(60+1+1) + 1/(60+0+1) = 1/62 + 1/61 ≈ 0.0323
        let hit_2 = result.iter().find(|h| h.id == 2).unwrap();
        let expected_score = 1.0 / 62.0 + 1.0 / 61.0;
        assert!(
            (hit_2.rrf_score - expected_score).abs() < 1e-10,
            "score for id 2 should be {:.10}, got {:.10}",
            expected_score,
            hit_2.rrf_score
        );
    }

    #[test]
    fn test_rrf_fusion_empty_inputs() {
        let result = reciprocal_rank_fusion(vec![], vec![], 60);
        assert!(result.is_empty());
    }

    #[test]
    fn test_rrf_fusion_truncates_to_5() {
        let fts: Vec<SearchHit> = (1..=10).map(|i| make_hit(i, &format!("doc-{}", i))).collect();
        let vec: Vec<SearchHit> = (6..=15).map(|i| make_hit(i, &format!("doc-{}", i))).collect();

        let result = reciprocal_rank_fusion(fts, vec, 60);
        assert!(result.len() <= 5, "should truncate to 5, got {}", result.len());
    }
}