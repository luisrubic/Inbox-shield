import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiErrore implements Exception {
  ApiErrore(this.messaggio);
  final String messaggio;
  @override
  String toString() => messaggio;
}

class Api {
  Api._();
  static final Api i = Api._();

  String server = 'http://192.168.1.10:8080';
  String? token;
  late SharedPreferences _p;

  Future<void> carica() async {
    _p = await SharedPreferences.getInstance();
    server = _p.getString('server') ?? server;
    token = _p.getString('token');
  }

  Future<void> impostaServer(String s) async {
    server = s.trim().replaceAll(RegExp(r'/+$'), '');
    await _p.setString('server', server);
  }

  Future<void> esci() async {
    token = null;
    await _p.remove('token');
  }

  Future<dynamic> _chiama(String metodo, String percorso, {Map<String, dynamic>? corpo, Map<String, String>? query}) async {
    final uri = Uri.parse('$server$percorso').replace(queryParameters: query);
    final h = {'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'};
    try {
      final req = http.Request(metodo, uri)..headers.addAll(h);
      if (corpo != null) req.body = jsonEncode(corpo);
      final r = await http.Response.fromStream(await req.send()).timeout(const Duration(seconds: 60));
      final d = r.body.isEmpty ? {} : jsonDecode(utf8.decode(r.bodyBytes));
      if (r.statusCode >= 200 && r.statusCode < 300) return d;
      if (r.statusCode == 401 && token != null) await esci();
      throw ApiErrore(d is Map && d['errore'] != null ? '${d['errore']}' : 'Errore ${r.statusCode}');
    } on TimeoutException {
      throw ApiErrore('Il server non risponde.');
    } on SocketException {
      throw ApiErrore('Server non raggiungibile: controlla l\'indirizzo nelle impostazioni.');
    } on FormatException {
      throw ApiErrore('Indirizzo del server non valido.');
    } on http.ClientException {
      throw ApiErrore('Server non raggiungibile.');
    }
  }

  Future<void> _accedi(String percorso, String email, String password) async {
    final d = await _chiama('POST', percorso, corpo: {'email': email, 'password': password});
    token = d['token'] as String;
    await _p.setString('token', token!);
  }

  Future<void> login(String e, String p) => _accedi('/auth/login', e, p);
  Future<void> registra(String e, String p) => _accedi('/auth/registra', e, p);

  Future<Map<String, dynamic>> autoconfig(String email) async =>
      Map<String, dynamic>.from(await _chiama('GET', '/caselle/autoconfig', query: {'email': email}));

  Future<List<Map<String, dynamic>>> caselle() async =>
      ((await _chiama('GET', '/caselle'))['caselle'] as List).map((e) => Map<String, dynamic>.from(e)).toList();

  Future<List<Map<String, dynamic>>> providerOauth() async =>
      ((await _chiama('GET', '/caselle/oauth/provider'))['provider'] as List).map((e) => Map<String, dynamic>.from(e)).toList();

  /// URL di Google/Microsoft da aprire nel browser: il collegamento si chiude da solo sul server.
  Future<String> avviaOauth(String provider) async =>
      '${(await _chiama('POST', '/caselle/oauth/avvia', corpo: {'provider': provider}))['url']}';

  Future<void> aggiungiCasella(String indirizzo, String password) =>
      _chiama('POST', '/caselle', corpo: {'indirizzo': indirizzo, 'password': password});

  Future<void> rimuoviCasella(int id) => _chiama('DELETE', '/caselle/$id');

  Future<List<Map<String, dynamic>>> mail(int id, {bool nonLette = false}) async =>
      ((await _chiama('GET', '/caselle/$id/mail', query: {if (nonLette) 'nonLette': '1'}))['mail'] as List)
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

  Future<Map<String, dynamic>> leggi(int id, int uid) async =>
      Map<String, dynamic>.from(await _chiama('GET', '/caselle/$id/mail/$uid'));

  Future<void> rispondi(int id, int uid, String testo) =>
      _chiama('POST', '/caselle/$id/rispondi/$uid', corpo: {'testo': testo});

  Future<void> invia(int id, String a, String oggetto, String testo) =>
      _chiama('POST', '/caselle/$id/invia', corpo: {'a': a, 'oggetto': oggetto, 'testo': testo});

  Future<List<Map<String, dynamic>>> regole() async =>
      ((await _chiama('GET', '/regole'))['regole'] as List).map((e) => Map<String, dynamic>.from(e)).toList();

  Future<void> nuovaRegola(Map<String, dynamic> r) => _chiama('POST', '/regole', corpo: r);
  Future<void> eliminaRegola(int id) => _chiama('DELETE', '/regole/$id');
  Future<void> attivaRegola(int id, bool on) => _chiama('PATCH', '/regole/$id', corpo: {'attiva': on});

  Future<List<Map<String, dynamic>>> applicaRegole(int id) async =>
      ((await _chiama('POST', '/caselle/$id/regole/applica', corpo: {}))['fatte'] as List)
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
}
