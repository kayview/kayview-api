import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const KayviewApp());
}

class KayviewApp extends StatelessWidget {
  const KayviewApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'KAYVIEW CHARGER',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0a0614),
      ),
      home: const WebViewScreen(),
    );
  }
}

class WebViewScreen extends StatefulWidget {
  const WebViewScreen({super.key});
  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> {
  late final WebViewController controller;
  bool isOffline = false;
  String apiUrl = "https://kayview-api.onrender.com";

  @override
  void initState() {
    super.initState();

    final WebViewController ctrl = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0a0614))
      ..setUserAgent("KayviewApp/1.0")
      ..enableZoom(false)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (url) {
            // ✅ FIXED: use ctrl, not controller, and only on Finished
            ctrl.runJavaScript(
              "window.KAYVIEW_API_URL='$apiUrl'; window.API_URL='$apiUrl'; localStorage.setItem('kv_api_url','$apiUrl');"
            );
          },
          onWebResourceError: (error) {
            if (error.errorType == WebResourceErrorType.hostLookup ||
                error.errorType == WebResourceErrorType.connect ||
                error.errorType == WebResourceErrorType.timeout) {
              ctrl.loadFlutterAsset("assets/offline.html");
            }
          },
        ),
      )
      ..addJavaScriptChannel('KayviewBridge',
        onMessageReceived: (msg) {
          debugPrint("JS Bridge: ${msg.message}");
        },
      )
      ..loadFlutterAsset("assets/index.html");

    if (ctrl.platform is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(true);
      final androidCtrl = ctrl.platform as AndroidWebViewController;
      androidCtrl.setMediaPlaybackRequiresUserGesture(false);
    }

    controller = ctrl;
    checkConnectivity();
  }

  Future<void> checkConnectivity() async {
    final result = await Connectivity().checkConnectivity();
    if (result.contains(ConnectivityResult.none)) {
      setState(() => isOffline = true);
      controller.loadFlutterAsset("assets/offline.html");
    }
    Connectivity().onConnectivityChanged.listen((results) {
      if (results.contains(ConnectivityResult.none)) {
        controller.loadFlutterAsset("assets/offline.html");
      } else {
        if (isOffline) {
          controller.loadFlutterAsset("assets/index.html");
          setState(() => isOffline = false);
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0a0614),
      body: SafeArea(
        child: WebViewWidget(controller: controller),
      ),
    );
  }
}