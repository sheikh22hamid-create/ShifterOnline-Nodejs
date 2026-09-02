package com.shifter.driver.adepter;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.R;

import java.util.List;

public class RecentOrderHomeAdapter extends RecyclerView.Adapter<RecentOrderHomeAdapter.MyViewHolder> {

    private final Context mContext;
    private final List<String> mCatlist;
    private final RecyclerTouchListener listener;

    public interface RecyclerTouchListener {
        void onClickRecentOrderItem(String titel, int position);
    }

    public class MyViewHolder extends RecyclerView.ViewHolder {

        public TextView txtToaddress;
        public TextView txtFromaddress;
        public TextView txtKm;
        public TextView txtEarning;
        public TextView txtMit;
        public TextView txtContinue;
        public LinearLayout lvlItemclick;

        public MyViewHolder(View view) {
            super(view);
            txtToaddress = view.findViewById(R.id.txt_toaddress);
            txtFromaddress = view.findViewById(R.id.txt_fromaddress);
            txtKm = view.findViewById(R.id.txt_km);
            txtEarning = view.findViewById(R.id.txt_earning);
            txtMit = view.findViewById(R.id.txt_mit);
            txtContinue = view.findViewById(R.id.txt_continue);
            lvlItemclick = view.findViewById(R.id.lvl_itemclick);
        }
    }

    public RecentOrderHomeAdapter(Context mContext, List<String> mCatlist, final RecyclerTouchListener listener) {
        this.mContext = mContext;
        this.mCatlist = mCatlist;
        this.listener = listener;

    }

    @Override
    public MyViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View itemView;

        itemView = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_rorder_home, parent, false);

        return new MyViewHolder(itemView);
    }

    @Override
    public void onBindViewHolder(final MyViewHolder holder, int position) {

        holder.lvlItemclick.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                listener.onClickRecentOrderItem("",0);
            }
        });

    }

    @Override
    public int getItemCount() {
//        return mCatlist.size();
        return 1;
    }
}
