package com.codexbridge.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import me.saket.telephoto.zoomable.coil.ZoomableAsyncImage
import me.saket.telephoto.zoomable.rememberZoomableImageState
import me.saket.telephoto.zoomable.rememberZoomableState
import java.security.MessageDigest

class ImageViewerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val imageUrl = intent.getStringExtra(EXTRA_URL).orEmpty()
        val previewUrl = intent.getStringExtra(EXTRA_PREVIEW_URL).orEmpty()
        val token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()
        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "查看图片" }

        if (imageUrl.isBlank() || previewUrl.isBlank() || token.isBlank()) {
            finish()
            return
        }

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = ViewerBlack,
                    surface = ViewerSurface,
                    primary = ViewerBlue,
                    onBackground = Color.White,
                    onSurface = Color.White,
                ),
            ) {
                NativeImageViewer(
                    imageUrl = imageUrl,
                    previewUrl = previewUrl,
                    token = token,
                    title = title,
                    onBack = ::finish,
                )
            }
        }
    }

    companion object {
        const val EXTRA_URL = "image_url"
        const val EXTRA_PREVIEW_URL = "image_preview_url"
        const val EXTRA_TOKEN = "image_token"
        const val EXTRA_TITLE = "image_title"
    }
}

private val ViewerBlack = Color(0xFF05070A)
private val ViewerSurface = Color(0xF021252B)
private val ViewerBlue = Color(0xFF70A7F5)

@Composable
private fun NativeImageViewer(
    imageUrl: String,
    previewUrl: String,
    token: String,
    title: String,
    onBack: () -> Unit,
) {
    var chromeVisible by remember { mutableStateOf(true) }
    var chromeRevision by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val zoomableState = rememberZoomableState()
    val imageState = rememberZoomableImageState(zoomableState)

    fun keepChromeVisible() {
        chromeVisible = true
        chromeRevision += 1
    }

    val cacheNamespace = remember(imageUrl, token) {
        "bridge-image:${sha256(token).take(16)}"
    }
    val previewRequest = remember(previewUrl, token) {
        ImageRequest.Builder(context)
            .data(previewUrl)
            .addHeader("Authorization", "Bearer $token")
            .memoryCacheKey("$cacheNamespace:preview:$previewUrl")
            .diskCacheKey("$cacheNamespace:preview:$previewUrl")
            .crossfade(120)
            .build()
    }
    val originalRequest = remember(imageUrl, token, retry) {
        ImageRequest.Builder(context)
            .data(imageUrl)
            .addHeader("Authorization", "Bearer $token")
            .memoryCacheKey("$cacheNamespace:original:$imageUrl")
            .diskCacheKey("$cacheNamespace:original:$imageUrl")
            .listener(
                onStart = {
                    loading = true
                    failed = false
                },
                onSuccess = { _, _ ->
                    loading = false
                    failed = false
                },
                onError = { _, _ ->
                    loading = false
                    failed = true
                },
            )
            .build()
    }

    BackHandler(onBack = onBack)
    LaunchedEffect(chromeVisible, chromeRevision) {
        if (chromeVisible) {
            delay(3_200)
            chromeVisible = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ViewerBlack),
    ) {
        AsyncImage(
            model = previewRequest,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 4.dp, vertical = 62.dp),
        )

        ZoomableAsyncImage(
            model = originalRequest,
            contentDescription = title,
            state = imageState,
            contentScale = ContentScale.Fit,
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 62.dp),
            onClick = {
                if (chromeVisible) chromeVisible = false else keepChromeVisible()
            },
            modifier = Modifier
                .fillMaxSize()
                .testTag("image-viewer-canvas"),
        )

        AnimatedVisibility(
            visible = loading && !failed,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Surface(
                color = Color(0xD921252B),
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(bottom = 92.dp),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(17.dp),
                        color = ViewerBlue,
                        strokeWidth = 2.dp,
                    )
                    Text("正在载入清晰原图", color = Color(0xFFD5DAE3), fontSize = 12.sp)
                }
            }
        }

        if (failed) {
            Surface(
                color = ViewerSurface,
                shape = RoundedCornerShape(22.dp),
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(28.dp),
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 26.dp, vertical = 22.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("原图暂时无法打开", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    Text("预览仍可查看，检查电脑连接后再试", color = Color(0xFFA7ADB8), fontSize = 13.sp)
                    Spacer(Modifier.height(14.dp))
                    Surface(
                        onClick = {
                            loading = true
                            failed = false
                            retry += 1
                        },
                        color = Color(0xFF2E5688),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.testTag("image-viewer-retry"),
                    ) {
                        Text("重新加载", modifier = Modifier.padding(horizontal = 20.dp, vertical = 11.dp))
                    }
                }
            }
        }

        AnimatedVisibility(
            visible = chromeVisible,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Surface(
                color = ViewerBlack.copy(alpha = 0.92f),
                contentColor = Color.White,
                modifier = Modifier
                    .fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回任务", tint = Color.White)
                    }
                    Text(
                        text = title,
                        modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.Medium,
                        fontSize = 16.sp,
                        color = Color.White,
                    )
                    Spacer(Modifier.width(48.dp))
                }
            }
        }

        AnimatedVisibility(
            visible = chromeVisible && !failed,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Surface(
                color = ViewerSurface,
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(bottom = 18.dp),
                shadowElevation = 12.dp,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    IconButton(
                        onClick = {
                            keepChromeVisible()
                            coroutineScope.launch { zoomableState.zoomBy(1f / 1.5f) }
                        },
                        modifier = Modifier.size(48.dp).testTag("image-viewer-zoom-out"),
                    ) {
                        Text("−", fontSize = 25.sp, fontWeight = FontWeight.Light)
                    }
                    Text(
                        text = "缩放",
                        modifier = Modifier.width(48.dp),
                        color = Color(0xFFDCE1EA),
                        fontSize = 12.sp,
                    )
                    IconButton(
                        onClick = {
                            keepChromeVisible()
                            coroutineScope.launch { zoomableState.zoomBy(1.5f) }
                        },
                        modifier = Modifier.size(48.dp).testTag("image-viewer-zoom-in"),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "放大")
                    }
                    Surface(
                        onClick = {
                            keepChromeVisible()
                            coroutineScope.launch { zoomableState.resetZoom() }
                        },
                        color = Color.Transparent,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.testTag("image-viewer-reset"),
                    ) {
                        Text(
                            "适应",
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
                            color = ViewerBlue,
                            fontSize = 13.sp,
                        )
                    }
                }
            }
        }
    }
}

private fun sha256(value: String): String = MessageDigest
    .getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { byte -> "%02x".format(byte) }
