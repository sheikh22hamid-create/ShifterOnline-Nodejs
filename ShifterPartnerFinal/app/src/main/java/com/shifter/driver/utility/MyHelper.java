package com.shifter.driver.utility;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;


public class MyHelper extends SQLiteOpenHelper {
    public static final String DATABASE_NAME = "mydatabase.db";
    public static final String TABLE_NAME = "buyanything";
    public static final String TABLE_NAME_ITME = "buyanything_itme";

    SessionManager sessionManager;
    Context contextA;


//    public List<BuyAnything> getStore() {
//        List<BuyAnything> list = new ArrayList<>();
//        SQLiteDatabase db = this.getWritableDatabase();
//
//        try {
//            Cursor c = db.rawQuery("select * from buyanything ", null);
//            if (c.getCount() != -1) { //if the row exist then return the id
//                while (c.moveToNext()) {
//                    BuyAnything item = new BuyAnything();
//
//                    item.setId(c.getString(0));
//                    item.setStoreName(c.getString(1));
//                    item.setStoreAddress(c.getString(2));
//                    item.setStoreLats("" + c.getString(3));
//                    item.setStoreLongs(c.getString(4));
//                    item.setpMethod(c.getString(5));
//                    item.setdCharge(c.getDouble(6));
//                    item.setCouponid(c.getInt(7));
//                    item.setCouponamount(c.getDouble(8));
//                    item.setTotal(c.getDouble(9));
//                    list.add(item);
//                }
//
//            }
//        } catch (Exception e) {
//            Log.e("Error", "-->" + e.toString());
//
//        }
//        return list;
//    }
//
//    public List<BuyItem> getStoreItem() {
//        List<BuyItem> list = new ArrayList<>();
//        SQLiteDatabase db = this.getWritableDatabase();
//
//        try {
//            Cursor c = db.rawQuery("select * from buyanything_itme ", null);
//            if (c.getCount() != -1) { //if the row exist then return the id
//                while (c.moveToNext()) {
//                    BuyItem item = new BuyItem();
//
//                    item.setId(c.getInt(0));
//                    item.setItemname(c.getString(1));
//                    item.setQty(c.getString(2));
//
//                    list.add(item);
//                }
//
//            }
//        } catch (Exception e) {
//            Log.e("Error", "-->" + e.toString());
//
//        }
//        return list;
//    }


    public MyHelper(Context context) {
        super(context, DATABASE_NAME, null, 1);
        sessionManager = new SessionManager(context);
        contextA = context;
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("create table " + TABLE_NAME + " (ID INTEGER PRIMARY KEY AUTOINCREMENT, storeName TEXT , storeAddress TEXT , storeLats TEXT , storeLongs TEXT , pMethod TEXT, dCharge double , couponid int , couponamount double , total double )");
        db.execSQL("create table " + TABLE_NAME_ITME + " (ID INTEGER PRIMARY KEY AUTOINCREMENT, storeItem TEXT, quantity int,sid int )");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS " + TABLE_NAME);
        onCreate(db);
    }
    public boolean insertItme(String id,String itmetitle,int qty){
        if (getItmeID(id) == -1) {
            SQLiteDatabase db = this.getWritableDatabase();
            ContentValues contentValues = new ContentValues();
            contentValues.put("storeItem", itmetitle);
            contentValues.put("quantity", qty);
            long result = db.insert(TABLE_NAME_ITME, null, contentValues);
            return result != -1;
        } else {
            return updateData(id, qty);

        }
    }
//    public boolean insertStore(BuyAnything rModel) {
//        deleteCard();
//
//            SQLiteDatabase db = this.getWritableDatabase();
//            ContentValues contentValues = new ContentValues();
//
//            contentValues.put("storeName", rModel.getStoreName());
//            contentValues.put("storeAddress", rModel.getStoreAddress());
//            contentValues.put("storeLats", rModel.getStoreLats());
//            contentValues.put("storeLongs", rModel.getStoreLongs());
//            contentValues.put("pMethod", rModel.getpMethod());
//            contentValues.put("dCharge", rModel.getdCharge());
//            contentValues.put("couponid", rModel.getCouponid());
//            contentValues.put("couponamount", rModel.getCouponamount());
//            contentValues.put("total", rModel.getTotal());
//
//            long result = db.insert(TABLE_NAME, null, contentValues);
//            if (result == -1) {
//                return false;
//            } else {
//                return true;
//            }
//
//
//
//    }

    public int isStore(String rid) {
        SQLiteDatabase db = this.getWritableDatabase();
        Cursor c = db.query(TABLE_NAME, new String[]{"RID"}, "RID =? ", new String[]{rid}, null, null, null, null);
        if (c.moveToFirst()) { //if the row exist then return the id
            return c.getInt(0);
        } else {
            Cursor cursor = getAllData();
            if (cursor.getCount() != 0) {
                return -1;
            }
            return cursor.getCount();
        }
    }

    private int getID(String pid) {
        SQLiteDatabase db = this.getWritableDatabase();
        Cursor c = db.query(TABLE_NAME, new String[]{"ID"}, "ID =? ", new String[]{pid}, null, null, null, null);
        if (c.moveToFirst()) //if the row exist then return the id
            return c.getInt(0);
        return -1;
    }

    private int getItmeID(String pid) {
        SQLiteDatabase db = this.getWritableDatabase();
        Cursor c = db.query(TABLE_NAME_ITME, new String[]{"ID"}, "ID =? ", new String[]{pid}, null, null, null, null);
        if (c.moveToFirst()) //if the row exist then return the id
            return c.getInt(0);
        return -1;
    }


    public Cursor getAllData() {
        SQLiteDatabase db = this.getWritableDatabase();
        Cursor res = db.rawQuery("select * from " + TABLE_NAME, null);
        return res;
    }


    public boolean updateData(String id, int qty) {
        SQLiteDatabase db = this.getWritableDatabase();
        ContentValues contentValues = new ContentValues();
        contentValues.put("quantity", qty);
        db.update(TABLE_NAME_ITME, contentValues, "ID = ? ", new String[]{id});

        return true;
    }

    public void deleteCard() {
        SQLiteDatabase db = this.getWritableDatabase();
        db.execSQL("delete from " + TABLE_NAME);
        db.execSQL("delete from " + TABLE_NAME_ITME);


    }

    public Integer deleteRData(String id) {
        SQLiteDatabase db = this.getWritableDatabase();
        Integer a = db.delete(TABLE_NAME_ITME, "ID = ? ", new String[]{id});

        return a;
    }
}