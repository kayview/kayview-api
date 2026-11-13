import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter_overlay_window/flutter_overlay_window.dart';

// ============ OVERLAY - FLOATING LOGO OVER OTHER APPS ============
@pragma('vm:entry-point')
void overlayMain() {
  runApp(const MaterialApp(
    debugShowCheckedModeBanner: false,
    home: OverlayLogo(),
  ));
}

class OverlayLogo extends StatefulWidget {
  const OverlayLogo({super.key});
  @override
  State<OverlayLogo> createState() => _OverlayLogoState();
}

class _OverlayLogoState extends State<OverlayLogo> {
  bool isRunning = true;
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: GestureDetector(
        onTap: () async {
          setState(() => isRunning = !isRunning);
          await FlutterOverlayWindow.shareData(isRunning ? 'running' : 'stopped');
        },
        child: Container(
          width: 80, height: 80,
          decoration: BoxDecoration(
            color: isRunning ? Colors.pinkAccent : Colors.grey,
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(blurRadius: 20, color: Colors.pinkAccent.withOpacity(0.6))],
          ),
          child: Center(child: Text(isRunning ? 'STOP' : 'PLAY', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white))),
        ),
      ),
    );
  }
}

// ============ MAIN APP ============
void main() => runApp(const KayviewApp());

class KayviewApp extends StatelessWidget {
  const KayviewApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(scaffoldBackgroundColor: const Color(0xFF0A0614)),
      home: const LicenseScreen(),
    );
  }
}

// ============ 1. LICENSE KEY SCREEN ============
class LicenseScreen extends StatefulWidget {
  const LicenseScreen({super.key});
  @override
  State<LicenseScreen> createState() => _LicenseScreenState();
}

class _LicenseScreenState extends State<LicenseScreen> {
  final keyController = TextEditingController();
  bool loading = false;
  String msg = '';

  Future<void> validateKey() async {
    final key = keyController.text.trim();
    if (key.isEmpty) { setState(() => msg = 'Enter your license key'); return; }
    setState(() { loading = true; msg = ''; });
    try {
      final res = await http.get(Uri.parse('https://kayview-api.onrender.com/api/v1/keys/validate?key=$key'));
      final data = jsonDecode(res.body);
      if (data['valid'] == true) {
        if (!mounted) return;
        Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => HomeScreen(key: key)));
      } else {
        setState(() => msg = 'INVALID KEY ❌ - Buy a key below');
      }
    } catch (e) {
      setState(() => msg = 'Cannot reach server. Check internet.');
    }
    setState(() => loading = false);
  }

  Future<void> buyKey() async {
    final uri = Uri.parse('https://kayview-api.onrender.com/payfast/create');
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          const Text('KAYVIEW CHARGER', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.pinkAccent)),
          const SizedBox(height: 8),
          const Text('Enter your license key to continue', style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 30),
          TextField(controller: keyController, decoration: const InputDecoration(hintText: 'AHE-XXX-XXX-XX', border: OutlineInputBorder())),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, child: ElevatedButton(onPressed: loading ? null : validateKey, child: Text(loading ? 'CHECKING...' : 'ACTIVATE'))),
          const SizedBox(height: 12),
          Text(msg, style: const TextStyle(color: Colors.redAccent)),
          const SizedBox(height: 20),
          const Text("Don't have a key?", style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 8),
          SizedBox(width: double.infinity, child: OutlinedButton(onPressed: buyKey, child: const Text('BUY KEY - R550'))),
        ]),
      ),
    );
  }
}

// ============ 2. HOME SCREEN ============
class HomeScreen extends StatelessWidget {
  final String key;
  const HomeScreen({super.key, required this.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('KAYVIEW CHARGER'), backgroundColor: Colors.pinkAccent),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(child: ListTile(title: Text('Key: $key'), subtitle: const Text('VERIFIED ✅'))),
        Card(child: ListTile(
          title: const Text('▶ START OVERLAY'),
          subtitle: const Text('Floating logo over other apps'),
          onTap: () async {
            bool granted = await FlutterOverlayWindow.isPermissionGranted();
            if (!granted) {
              granted = await FlutterOverlayWindow.requestPermission() ?? false;
              if (!granted) return;
            }
            await FlutterOverlayWindow.showOverlay(enableDrag: true, height: 100, width: 100, alignment: OverlayAlignment.centerRight);
          },
        )),
        Card(child: ListTile(title: const Text('⏹ STOP OVERLAY'), onTap: () => FlutterOverlayWindow.closeOverlay())),
        const Card(child: ListTile(title: Text('👥 PAIRS'))),
        const Card(child: ListTile(title: Text('📜 LOGS'))),
        const Card(child: ListTile(title: Text('🤖 ROBOT LIST'))),
      ]),
    );
  }
}