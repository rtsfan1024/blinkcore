use std::sync::LazyLock;

use schemars::schema_for;

use crate::types::search::{LeadsRequest, SearchRequest};
use crate::types::sync::SyncRequest;

/// JSON Schema for SyncRequest (供外部文档生成工具使用)
#[allow(dead_code)]
pub static ADMIN_SYNC_REQUEST_SCHEMA: LazyLock<schemars::schema::RootSchema> =
    LazyLock::new(|| schema_for!(SyncRequest));

/// JSON Schema for SearchRequest (供外部文档生成工具使用)
#[allow(dead_code)]
pub static SEARCH_REQUEST_SCHEMA: LazyLock<schemars::schema::RootSchema> =
    LazyLock::new(|| schema_for!(SearchRequest));

/// JSON Schema for LeadsRequest (供外部文档生成工具使用)
#[allow(dead_code)]
pub static LEADS_REQUEST_SCHEMA: LazyLock<schemars::schema::RootSchema> =
    LazyLock::new(|| schema_for!(LeadsRequest));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_generation() {
        let schema = &*ADMIN_SYNC_REQUEST_SCHEMA;
        let json = serde_json::to_value(schema).expect("serialize schema");
        let obj = json.as_object().expect("schema is object");

        // 验证 required 字段存在
        let required = obj
            .get("required")
            .and_then(|v| v.as_array())
            .expect("schema has required array");
        let required_strs: Vec<&str> = required
            .iter()
            .map(|v| v.as_str().expect("required item is string"))
            .collect();
        assert!(
            required_strs.contains(&"apiVersion"),
            "apiVersion should be required"
        );
        assert!(
            required_strs.contains(&"articles"),
            "articles should be required"
        );

        // 验证 additionalProperties=false
        let properties = obj
            .get("properties")
            .and_then(|v| v.as_object())
            .expect("schema has properties");
        for (_, prop_schema) in properties {
            if let Some(obj) = prop_schema.as_object() {
                if obj.contains_key("properties") {
                    assert_eq!(
                        obj.get("additionalProperties")
                            .and_then(|v| v.as_bool()),
                        Some(false),
                        "nested objects should have additionalProperties=false"
                    );
                }
            }
        }

        // SearchRequest: query_vector 为 optional
        let search_schema = &*SEARCH_REQUEST_SCHEMA;
        let search_json = serde_json::to_value(search_schema).expect("serialize search schema");
        let search_obj = search_json.as_object().expect("search schema is object");
        let search_req = search_obj
            .get("required")
            .and_then(|v| v.as_array())
            .expect("search has required");
        assert!(
            search_req.iter().any(|v| v.as_str() == Some("query_text")),
            "query_text should be required"
        );
        assert!(
            !search_req.iter().any(|v| v.as_str() == Some("query_vector")),
            "query_vector should NOT be required"
        );
    }

    #[test]
    fn test_leads_schema_contact_method_enum() {
        let schema = &*LEADS_REQUEST_SCHEMA;
        let json = serde_json::to_value(schema).expect("serialize leads schema");
        let obj = json.as_object().expect("leads schema is object");

        let contact_method = obj
            .get("properties")
            .and_then(|v| v.as_object())
            .and_then(|p| p.get("contact_method"))
            .and_then(|v| v.as_object())
            .expect("contact_method schema");

        // schemars 将 enum 类型放入 definitions，contact_method 是 $ref 引用
        let enum_values = if let Some(ref_path) = contact_method.get("$ref").and_then(|v| v.as_str()) {
            let type_name = ref_path.rsplit('/').next().expect("ref type name");
            let defs = obj
                .get("definitions")
                .and_then(|v| v.as_object())
                .expect("schema has definitions");
            let def = defs
                .get(type_name)
                .and_then(|v| v.as_object())
                .expect("contact_method type in definitions");
            def.get("enum")
                .and_then(|v| v.as_array())
                .expect("contact_method type has enum in definitions")
        } else {
            contact_method
                .get("enum")
                .and_then(|v| v.as_array())
                .expect("contact_method has enum")
        };

        let variants: Vec<&str> = enum_values
            .iter()
            .map(|v| v.as_str().expect("enum variant is string"))
            .collect();
        assert!(variants.contains(&"email"));
        assert!(variants.contains(&"wechat"));
        assert!(variants.contains(&"telegram"));
    }
}