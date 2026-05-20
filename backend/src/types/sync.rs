use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArticleMetadata {
    pub slug: String,
    pub title: String,
    pub visibility: String,
    #[serde(rename = "content_hash")]
    pub content_hash: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ChunkData {
    pub chunk_index: i32,
    pub heading_level: i32,
    pub heading_text: String,
    pub slug_anchor: String,
    pub content: String,
    pub dense_embedding: Vec<f32>,
}

impl ChunkData {
    /// 校验 dense_embedding 维度是否为 384 且不含 NaN/Inf
    pub fn validate_embedding(&self) -> Result<(), String> {
        if self.dense_embedding.len() != 384 {
            return Err(format!(
                "dense_embedding dimension mismatch: expected 384, got {}",
                self.dense_embedding.len()
            ));
        }
        for (i, &v) in self.dense_embedding.iter().enumerate() {
            if v.is_nan() {
                return Err(format!("dense_embedding contains NaN at index {}", i));
            }
            if v.is_infinite() {
                return Err(format!("dense_embedding contains Inf at index {}", i));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArticleSpec {
    #[serde(rename = "raw_content")]
    pub raw_content: String,
    #[serde(rename = "excalidraw_data", skip_serializing_if = "Option::is_none")]
    pub excalidraw_data: Option<Value>,
    pub chunks: Vec<ChunkData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArticlePayload {
    pub metadata: ArticleMetadata,
    pub spec: ArticleSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct SyncRequest {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub kind: String,
    #[serde(rename = "active_manifest")]
    pub active_manifest: Vec<String>,
    pub articles: Vec<ArticlePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncedArticle {
    pub slug: String,
    pub article_id: i64,
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResponse {
    pub synced: Vec<SyncedArticle>,
    pub pruned: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_article_metadata_serde() {
        let meta = ArticleMetadata {
            slug: "test".into(),
            title: "Test".into(),
            visibility: "public".into(),
            content_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".into(),
            tags: vec![],
        };
        let json = serde_json::to_string(&meta).expect("serialize");
        let deserialized: ArticleMetadata = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.slug, "test");
    }

    #[test]
    fn test_sync_request_serde() {
        let req = SyncRequest {
            api_version: "knowledge.your-domain.com/v1alpha1".into(),
            kind: "KnowledgeSyncPayload".into(),
            active_manifest: vec!["a".into()],
            articles: vec![],
        };
        let json = serde_json::to_string(&req).expect("serialize");
        let deserialized: SyncRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.kind, "KnowledgeSyncPayload");
    }

    #[test]
    fn test_chunk_data_validate_embedding_ok() {
        let chunk = ChunkData {
            chunk_index: 0,
            heading_level: 2,
            heading_text: "Intro".into(),
            slug_anchor: "intro".into(),
            content: "text".into(),
            dense_embedding: vec![0.1f32; 384],
        };
        assert!(chunk.validate_embedding().is_ok());
    }

    #[test]
    fn test_chunk_data_validate_embedding_nan() {
        let mut emb = vec![0.1f32; 384];
        emb[10] = f32::NAN;
        let chunk = ChunkData {
            chunk_index: 0,
            heading_level: 2,
            heading_text: "Intro".into(),
            slug_anchor: "intro".into(),
            content: "text".into(),
            dense_embedding: emb,
        };
        assert!(chunk.validate_embedding().is_err());
    }

    #[test]
    fn test_chunk_data_validate_embedding_wrong_dim() {
        let chunk = ChunkData {
            chunk_index: 0,
            heading_level: 2,
            heading_text: "Intro".into(),
            slug_anchor: "intro".into(),
            content: "text".into(),
            dense_embedding: vec![0.1f32; 128],
        };
        assert!(chunk.validate_embedding().is_err());
    }

    #[test]
    fn test_synced_article_serde() {
        let sa = SyncedArticle {
            slug: "test".into(),
            article_id: 42,
            chunk_count: 5,
        };
        let json = serde_json::to_string(&sa).expect("serialize");
        let deserialized: SyncedArticle = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.article_id, 42);
    }
}