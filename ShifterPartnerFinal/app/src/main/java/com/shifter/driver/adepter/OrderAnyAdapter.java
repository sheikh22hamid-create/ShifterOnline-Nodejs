package com.shifter.driver.adepter;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import java.text.DecimalFormat;
import java.util.List;

import com.shifter.driver.R;
import com.shifter.driver.model.BuyOrderHistoryItem;
import com.shifter.driver.utility.SessionManager;

public class OrderAnyAdapter extends RecyclerView.Adapter<OrderAnyAdapter.MyViewHolder> {

    private final Context mContext;
    private final List<BuyOrderHistoryItem> mCatlist;
    private final RecyclerTouchListener listener;
    SessionManager sessionManager;

    public interface RecyclerTouchListener {
        void onClickOrderItem(BuyOrderHistoryItem titel, int position);
    }

    public class MyViewHolder extends RecyclerView.ViewHolder {

        public TextView txtOrderid;
        public TextView txtStatus;
        public TextView txtToaddress;
        public TextView txtFromaddress;
        public TextView txtKm;
        public TextView txtEarning;
        public TextView txtMit;

        public LinearLayout lvlItemclick;

        public MyViewHolder(View view) {
            super(view);
            txtOrderid = view.findViewById(R.id.txt_orderid);
            txtStatus = view.findViewById(R.id.txt_status);
            txtToaddress = view.findViewById(R.id.txt_toaddress);
            txtFromaddress = view.findViewById(R.id.txt_fromaddress);
            txtKm = view.findViewById(R.id.txt_km);
            txtEarning = view.findViewById(R.id.txt_earning);
            txtMit = view.findViewById(R.id.txt_mit);
            lvlItemclick = view.findViewById(R.id.lvl_itemclick);
        }
    }

    public OrderAnyAdapter(Context mContext, List<BuyOrderHistoryItem> mCatlist, final RecyclerTouchListener listener) {
        this.mContext = mContext;
        this.mCatlist = mCatlist;
        this.listener = listener;
        sessionManager = new SessionManager(mContext);
    }

    @Override
    public MyViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View itemView;

        itemView = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_order_anyhome, parent, false);

        return new MyViewHolder(itemView);
    }

    @Override
    public void onBindViewHolder(final MyViewHolder holder, int position) {
        BuyOrderHistoryItem orderItem = mCatlist.get(position);

        holder.txtOrderid.setText(mContext.getString(R.string.orderid) + " :" + orderItem.getId());
        holder.txtStatus.setText(orderItem.getStatus());
        holder.txtToaddress.setText(orderItem.getStorePaddress());
        holder.txtFromaddress.setText(orderItem.getCustomerDaddress());
        holder.txtKm.setText(orderItem.getDistance() + "Km");
        holder.txtEarning.setText(sessionManager.getStringData(SessionManager.currency) + orderItem.getTotal()+" "+mContext.getString(R.string.earning));
        DecimalFormat df = new DecimalFormat("#.##");
      //  holder.txtMit.setText(df.format(Double.parseDouble(orderItem.getTimeDuration()))+" min deliver");
        holder.txtMit.setText(
                holder.itemView.getContext().getString(
                        R.string.time_to_deliver,
                        df.format(Double.parseDouble(orderItem.getTimeDuration()))
                )
        );

        holder.lvlItemclick.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                listener.onClickOrderItem(orderItem, 0);
            }
        });

    }

    @Override
    public int getItemCount() {
        return mCatlist.size();
    }
}
