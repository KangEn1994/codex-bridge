package com.codexbridge.mobile

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.net.URI

class ConnectionActivity : ComponentActivity() {
    private val scannerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
        val raw = result.data?.getStringExtra(ScannerActivity.EXTRA_RESULT).orEmpty()
        if (raw.isNotBlank()) {
            setResult(Activity.RESULT_OK, Intent().putExtra(RESULT_SCAN, raw))
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        val currentServer = intent.getStringExtra(EXTRA_CURRENT_SERVER).orEmpty()

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = ConnectionBackground,
                    surface = ConnectionSurface,
                    primary = ConnectionBlue,
                    onBackground = ConnectionText,
                    onSurface = ConnectionText,
                ),
            ) {
                ConnectionScreen(
                    currentServer = currentServer,
                    onClose = ::closeConnectionScreen,
                    onScan = ::startPairingScanner,
                    onConnect = ::returnManualConnection,
                )
            }
        }
    }

    private fun closeConnectionScreen() {
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    private fun startPairingScanner() {
        try {
            scannerLauncher.launch(Intent(this, ScannerActivity::class.java))
        } catch (_: RuntimeException) {
            Toast.makeText(this, R.string.scanner_start_failed, Toast.LENGTH_LONG).show()
        }
    }

    private fun returnManualConnection(server: String, token: String) {
        setResult(
            Activity.RESULT_OK,
            Intent()
                .putExtra(RESULT_SERVER, server)
                .putExtra(RESULT_TOKEN, token),
        )
        finish()
    }

    companion object {
        const val EXTRA_CURRENT_SERVER = "current_server"
        const val RESULT_SCAN = "pairing_scan"
        const val RESULT_SERVER = "pairing_server"
        const val RESULT_TOKEN = "pairing_token"
    }
}

private val ConnectionBackground = Color(0xFF080B0F)
private val ConnectionSurface = Color(0xFF151A20)
private val ConnectionBorder = Color(0xFF303945)
private val ConnectionDivider = Color(0xFF2A323D)
private val ConnectionText = Color(0xFFF4F6F8)
private val ConnectionMuted = Color(0xFFA4ABB5)
private val ConnectionBlue = Color(0xFF79B6FA)
private val ConnectionButtonText = Color(0xFF07111B)

@Composable
private fun ConnectionScreen(
    currentServer: String,
    onClose: () -> Unit,
    onScan: () -> Unit,
    onConnect: (String, String) -> Unit,
) {
    var manualExpanded by remember { mutableStateOf(false) }
    var server by remember(currentServer) { mutableStateOf(currentServer) }
    var token by remember { mutableStateOf("") }
    var serverError by remember { mutableStateOf<String?>(null) }
    var tokenError by remember { mutableStateOf<String?>(null) }

    BackHandler(onBack = onClose)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ConnectionBackground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = 14.dp, vertical = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = ConnectionSurface,
            shape = RoundedCornerShape(24.dp),
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 430.dp)
                .border(1.dp, ConnectionBorder, RoundedCornerShape(24.dp))
                .animateContentSize(),
        ) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp, vertical = 20.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top,
                ) {
                    Column {
                        Text(
                            text = "电脑连接",
                            color = ConnectionMuted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            letterSpacing = 0.3.sp,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "连接设置",
                            color = ConnectionText,
                            fontSize = 22.sp,
                            lineHeight = 28.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    IconButton(onClick = onClose, modifier = Modifier.size(44.dp)) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "关闭",
                            tint = ConnectionMuted,
                            modifier = Modifier.size(26.dp),
                        )
                    }
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 22.dp, bottom = 21.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Image(
                        painter = painterResource(R.mipmap.ic_launcher),
                        contentDescription = null,
                        modifier = Modifier
                            .size(68.dp)
                            .clip(RoundedCornerShape(18.dp)),
                    )
                    Spacer(Modifier.height(18.dp))
                    Text(
                        text = "扫码连接电脑",
                        color = ConnectionText,
                        fontSize = 20.sp,
                        lineHeight = 26.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "在电脑打开配对页，用 App 扫描二维码即可自动连接。",
                        color = ConnectionMuted,
                        fontSize = 13.sp,
                        lineHeight = 20.sp,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(18.dp))
                    Button(
                        onClick = onScan,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ConnectionBlue,
                            contentColor = ConnectionButtonText,
                        ),
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.ic_qr_code_scanner),
                            contentDescription = null,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = "打开扫码",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(ConnectionDivider),
                )

                Surface(
                    onClick = { manualExpanded = !manualExpanded },
                    color = Color.Transparent,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(vertical = 16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "手动输入地址和令牌",
                            color = ConnectionMuted,
                            fontSize = 13.sp,
                        )
                        Icon(
                            imageVector = Icons.Default.KeyboardArrowDown,
                            contentDescription = if (manualExpanded) "收起" else "展开",
                            tint = ConnectionMuted,
                            modifier = Modifier
                                .size(22.dp)
                                .rotate(if (manualExpanded) 180f else 0f),
                        )
                    }
                }

                AnimatedVisibility(visible = manualExpanded) {
                    Column(modifier = Modifier.padding(bottom = 4.dp)) {
                        OutlinedTextField(
                            value = server,
                            onValueChange = {
                                server = it
                                serverError = null
                            },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("电脑服务地址") },
                            placeholder = { Text("http://192.168.1.20:43110") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Uri,
                                imeAction = ImeAction.Next,
                            ),
                            isError = serverError != null,
                            supportingText = serverError?.let { message -> ({ Text(message) }) },
                            colors = connectionTextFieldColors(),
                            shape = RoundedCornerShape(14.dp),
                        )
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = token,
                            onValueChange = {
                                token = it
                                tokenError = null
                            },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("配对令牌（可选）") },
                            placeholder = { Text("粘贴电脑端令牌") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                            ),
                            visualTransformation = PasswordVisualTransformation(),
                            isError = tokenError != null,
                            supportingText = tokenError?.let { message -> ({ Text(message) }) },
                            colors = connectionTextFieldColors(),
                            shape = RoundedCornerShape(14.dp),
                        )
                        Spacer(Modifier.height(14.dp))
                        Button(
                            onClick = {
                                val normalized = normalizeServer(server)
                                serverError = if (normalized == null) "请输入有效的 HTTP 或 HTTPS 地址" else null
                                val trimmedToken = token.trim()
                                tokenError = if (trimmedToken.isNotEmpty() && trimmedToken.length < 20) {
                                    "令牌长度不正确"
                                } else null
                                if (normalized != null && tokenError == null) onConnect(normalized, trimmedToken)
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(52.dp),
                            shape = RoundedCornerShape(15.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = ConnectionBlue,
                                contentColor = ConnectionButtonText,
                            ),
                        ) {
                            Text("连接电脑", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun connectionTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = ConnectionText,
    unfocusedTextColor = ConnectionText,
    focusedContainerColor = Color(0xFF10151A),
    unfocusedContainerColor = Color(0xFF10151A),
    focusedBorderColor = ConnectionBlue,
    unfocusedBorderColor = ConnectionBorder,
    focusedLabelColor = ConnectionBlue,
    unfocusedLabelColor = ConnectionMuted,
    cursorColor = ConnectionBlue,
)

private fun normalizeServer(candidate: String): String? {
    var normalized = candidate.trim()
    if (normalized.isBlank()) return null
    if (!normalized.contains("://")) normalized = "http://$normalized"
    return try {
        val parsed = URI(normalized)
        if (parsed.host == null || parsed.userInfo != null ||
            !(parsed.scheme.equals("http", true) || parsed.scheme.equals("https", true))
        ) {
            null
        } else {
            normalized.trimEnd('/')
        }
    } catch (_: Exception) {
        null
    }
}
