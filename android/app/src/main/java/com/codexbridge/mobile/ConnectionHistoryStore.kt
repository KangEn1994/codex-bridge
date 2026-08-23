package com.codexbridge.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal data class SavedConnection(
    val server: String,
    val token: String,
    val savedAt: Long,
)

internal class ConnectionHistoryStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun load(): List<SavedConnection> {
        val raw = preferences.getString(HISTORY_KEY, null) ?: return emptyList()
        return try {
            val values = JSONArray(raw)
            buildList {
                for (index in 0 until values.length()) {
                    val value = values.optJSONObject(index) ?: continue
                    val server = normalizeServer(value.optString("server")) ?: continue
                    val token = value.optString("token").trim()
                    if (token.isNotEmpty() && token.length < MIN_CONNECTION_PASSWORD_LENGTH) continue
                    add(SavedConnection(server, token, value.optLong("savedAt", 0L)))
                    if (size >= MAX_HISTORY) break
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun remember(server: String, token: String): List<SavedConnection> {
        val normalized = normalizeServer(server) ?: return load()
        val next = listOf(SavedConnection(normalized, token.trim(), System.currentTimeMillis())) +
            load().filterNot { it.server.equals(normalized, ignoreCase = true) }
        return save(next.take(MAX_HISTORY))
    }

    fun remove(server: String): List<SavedConnection> = save(
        load().filterNot { it.server.equals(server, ignoreCase = true) },
    )

    private fun save(connections: List<SavedConnection>): List<SavedConnection> {
        val values = JSONArray()
        connections.take(MAX_HISTORY).forEach { connection ->
            values.put(
                JSONObject()
                    .put("server", connection.server)
                    .put("token", connection.token)
                    .put("savedAt", connection.savedAt),
            )
        }
        preferences.edit().putString(HISTORY_KEY, values.toString()).apply()
        return connections.take(MAX_HISTORY)
    }

    private companion object {
        const val PREFERENCES = "codex_bridge_connection_history"
        const val HISTORY_KEY = "manual_connections_v1"
        const val MAX_HISTORY = 5
    }
}
