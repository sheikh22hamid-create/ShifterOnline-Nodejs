package com.shifter.online

import android.content.ContentResolver
import android.database.Cursor
import android.provider.ContactsContract
import androidx.annotation.NonNull
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

class MainActivity: FlutterActivity() {
    private val CHANNEL = "com.shifter.online/contacts"
    private val executor = Executors.newSingleThreadExecutor()

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            if (call.method == "getContacts") {
                executor.execute {
                    try {
                        val contactList = fetchDeviceContacts()
                        runOnUiThread {
                            result.success(contactList)
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            result.error("CONTACTS_ERROR", e.message, null)
                        }
                    }
                }
            } else if (call.method == "openWhatsApp") {
                result.success(openWhatsAppApp())
            } else {
                result.notImplemented()
            }
        }
    }

    // Opens WhatsApp (or WhatsApp Business) the way its launcher icon does. A whatsapp:// link fails with
    // "Couldn't open this link" when WhatsApp is not already running in recents, so this is tried first.
    private fun openWhatsAppApp(): Boolean {
        for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            try {
                val intent = packageManager.getLaunchIntentForPackage(pkg) ?: continue
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
                return true
            } catch (e: Exception) {
                // try the next package
            }
        }
        return false
    }

    private fun fetchDeviceContacts(): List<Map<String, String>> {
        val uniqueMap = LinkedHashMap<String, Map<String, String>>()
        val cr: ContentResolver = contentResolver

        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        val cursor: Cursor? = cr.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE NOCASE ASC"
        )

        cursor?.use { c ->
            val nameIndex = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numberIndex = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

            while (c.moveToNext()) {
                val name = if (nameIndex >= 0) c.getString(nameIndex) ?: "" else ""
                val rawNumber = if (numberIndex >= 0) c.getString(numberIndex) ?: "" else ""

                if (rawNumber.trim().isEmpty()) continue

                val digitsOnly = rawNumber.replace(Regex("[^0-9]"), "")
                if (digitsOnly.length < 10) continue

                // Normalize to last 10 digits
                val normalizedPhone = digitsOnly.substring(digitsOnly.length - 10)

                if (!uniqueMap.containsKey(normalizedPhone)) {
                    val displayName = if (name.trim().isNotEmpty()) name.trim() else normalizedPhone
                    val item = HashMap<String, String>()
                    item["name"] = displayName
                    item["phone"] = normalizedPhone
                    item["rawNumber"] = rawNumber.trim()
                    uniqueMap[normalizedPhone] = item
                }
            }
        }

        return ArrayList(uniqueMap.values)
    }

    override fun onDestroy() {
        super.onDestroy()
        executor.shutdown()
    }
}
