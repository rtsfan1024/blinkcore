use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub heading_text: String,
    pub slug_anchor: String,
    pub snippet: String,
    pub visibility: String,
    pub rrf_score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Hybrid,
    FtsOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub slug: String,
    pub title: String,
    pub heading_text: String,
    pub slug_anchor: String,
    pub snippet: String,
    pub jump_url: String,
    pub rrf_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub mode: SearchMode,
    pub results: Vec<SearchResultItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct SearchRequest {
    pub query_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_vector: Option<Vec<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContactMethod {
    Email,
    Wechat,
    Telegram,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct LeadsRequest {
    pub target_slug: String,
    pub trigger_keyword: String,
    pub contact_method: ContactMethod,
    pub contact_value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LeadsResponse {
    pub lead_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArticleSummary {
    pub slug: String,
    pub title: String,
    pub created_at: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArticleListResponse {
    pub articles: Vec<ArticleSummary>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArticleListParams {
    pub page: Option<i32>,
    pub per_page: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ArticleContentResponse {
    pub slug: String,
    pub title: String,
    pub created_at: String,
    pub raw_content: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_hit_serde() {
        let hit = SearchHit {
            id: 1,
            slug: "test-article".into(),
            title: "Test Article".into(),
            heading_text: "Introduction".into(),
            slug_anchor: "introduction".into(),
            snippet: "this is a <mark>test</mark> snippet".into(),
            visibility: "public".into(),
            rrf_score: 0.5,
        };

        let json = serde_json::to_string(&hit).expect("serialize");
        let deserialized: SearchHit = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(deserialized.id, hit.id);
        assert_eq!(deserialized.slug, hit.slug);
        assert_eq!(deserialized.rrf_score, hit.rrf_score);
    }

    #[test]
    fn test_search_request_serde() {
        let req = SearchRequest {
            query_text: "test".into(),
            query_vector: None,
        };
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains("query_text"));

        let with_vec = SearchRequest {
            query_text: "test".into(),
            query_vector: Some(vec![0.1f64; 384]),
        };
        let json2 = serde_json::to_string(&with_vec).expect("serialize");
        assert!(json2.contains("query_vector"));
    }

    #[test]
    fn test_leads_request_serde() {
        let req = LeadsRequest {
            target_slug: "test".into(),
            trigger_keyword: "contact".into(),
            contact_method: ContactMethod::Email,
            contact_value: "test@example.com".into(),
            user_comment: None,
        };
        let json = serde_json::to_string(&req).expect("serialize");
        let deserialized: LeadsRequest = serde_json::from_str(&json).expect("deserialize");
        assert!(matches!(deserialized.contact_method, ContactMethod::Email));
        assert_eq!(deserialized.target_slug, "test");

        // 验证序列化值为 snake_case
        assert!(json.contains("email"));
        assert!(!json.contains("Email"));
    }

    #[test]
    fn test_leads_response_serde() {
        let resp = LeadsResponse {
            lead_id: "550e8400-e29b-41d4-a716-446655440000".into(),
            status: "received".into(),
        };
        let json = serde_json::to_string(&resp).expect("serialize");
        let deserialized: LeadsResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.status, "received");
    }

    #[test]
    fn test_article_list_response_serde() {
        let resp = ArticleListResponse {
            articles: vec![ArticleSummary {
                slug: "test".into(),
                title: "Test".into(),
                created_at: "2025-01-01T00:00:00Z".into(),
                tags: vec![],
            }],
            total: 1,
            page: 1,
            per_page: 20,
        };
        let json = serde_json::to_string(&resp).expect("serialize");
        let deserialized: ArticleListResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.total, 1);
    }

    #[test]
    fn test_article_list_params_defaults() {
        let params = ArticleListParams {
            page: None,
            per_page: None,
        };
        let page = params.page.unwrap_or(1);
        let per_page = params.per_page.unwrap_or(20);
        assert_eq!(page, 1);
        assert_eq!(per_page, 20);
    }
}