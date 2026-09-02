package com.shifter.driver.adepter;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.ColorStateList;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.recyclerview.widget.DefaultItemAnimator;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.R;

import java.util.List;

import com.shifter.driver.model.Itemimg;

public class ItemMainAdepter extends RecyclerView.Adapter<ItemMainAdepter.ViewHolder> {

    List<Itemimg> orderMainItemList;
    private final Context context;
    private LinearLayoutManager lln;
    private ItmeSubAdepter checkBoxAdapter;
    private final RecyclerTouchListener listener;

    public interface RecyclerTouchListener {

        void onClickChooseImag(String titel, int position);

        void onClickimageUpload(Itemimg itemimg, int position);
        void onClickItmeUnavalible(Itemimg itemimg, int position);
    }

    public static class ViewHolder extends RecyclerView.ViewHolder {
        public TextView txtUploadfrount;
        public RecyclerView recyclerRecentorders;
        public TextView txtContinue;
        public TextView txtUpload;
        public TextView txtTitle;
        public LinearLayout lvlItemclick;
        public TextView txtCancel;

        public EditText edPrice;
        public LinearLayout lvlPrice;

        public ViewHolder(View itemView) {
            super(itemView);
        // TODO: Add findViewById for views
        // Example: textView = itemView.findViewById(R.id.text_view);
            

        }
    }

    public ItemMainAdepter(List<Itemimg> orderMainItems, Context context, final RecyclerTouchListener listener) {
        this.orderMainItemList = orderMainItems;
        this.context = context;
        this.listener = listener;


    }

    @Override
    public ItemMainAdepter.ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_order_main, parent, false);
        ViewHolder vh = new ViewHolder(v);
        return vh;
    }

    @Override
    public void onBindViewHolder(ItemMainAdepter.ViewHolder holder, @SuppressLint("RecyclerView") int position) {
        lln = new LinearLayoutManager(context);
        Itemimg mainItem = orderMainItemList.get(position);
        if (mainItem.getItemImg().size() != 0) {
            holder.recyclerRecentorders.setVisibility(View.VISIBLE);
            holder.lvlPrice.setVisibility(View.VISIBLE);
            holder.txtContinue.setVisibility(View.VISIBLE);

            if (mainItem.getItemImg().get(0).contains("item_list") || mainItem.getItemImg().get(0).contains("images") ) {
                holder.txtUpload.setVisibility(View.VISIBLE);

                holder.txtUploadfrount.setVisibility(View.GONE);
                holder.txtCancel.setVisibility(View.GONE);
                holder.txtContinue.setVisibility(View.GONE);
                double temp = Double.parseDouble(mainItem.getItemTotal().toString()) / Integer.parseInt(mainItem.getQuantity());
                holder.edPrice.setText(String.format("%.2f", temp));
                holder.edPrice.setKeyListener(null);
            } else {
                holder.txtCancel.setVisibility(View.VISIBLE);
                holder.txtUploadfrount.setVisibility(View.VISIBLE);
                holder.txtContinue.setVisibility(View.VISIBLE);
                holder.txtUpload.setVisibility(View.GONE);


            }
            if (mainItem.getItemConfirm().equalsIgnoreCase("1")) {
                holder.txtUpload.setBackgroundTintList(ColorStateList.valueOf(context.getResources().getColor(R.color.green)));
                holder.txtUpload.setText(context.getString(R.string.confirm));
            } else  {
                holder.txtUpload.setBackgroundTintList(ColorStateList.valueOf(context.getResources().getColor(R.color.gray2)));
                holder.txtUpload.setText(context.getString(R.string.pending));
            }

            holder.recyclerRecentorders.setLayoutManager(lln);
            checkBoxAdapter = new ItmeSubAdepter(mainItem.getItemImg(), context);
            holder.recyclerRecentorders.setLayoutManager(new LinearLayoutManager(context, LinearLayoutManager.HORIZONTAL, false));
            holder.recyclerRecentorders.setItemAnimator(new DefaultItemAnimator());
            holder.recyclerRecentorders.setAdapter(checkBoxAdapter);
        } else {
            if(mainItem.getItemConfirm().equalsIgnoreCase("2")){
                holder.txtUploadfrount.setVisibility(View.GONE);
                holder.txtCancel.setVisibility(View.GONE);
                holder.txtUpload.setText(context.getString(R.string.item_unavailable));
                holder.lvlPrice.setVisibility(View.GONE);
                holder.txtContinue.setVisibility(View.GONE);
                holder.txtUpload.setVisibility(View.VISIBLE);

            }else {
                holder.txtUploadfrount.setVisibility(View.VISIBLE);
                holder.recyclerRecentorders.setVisibility(View.GONE);
                holder.lvlPrice.setVisibility(View.GONE);
                holder.txtContinue.setVisibility(View.GONE);
                holder.txtUpload.setVisibility(View.GONE);
                holder.txtCancel.setVisibility(View.VISIBLE);
            }




        }
        holder.txtTitle.setText(mainItem.getQuantity() + "x " + mainItem.getItemTitle());
        holder.txtUploadfrount.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                listener.onClickChooseImag("", position);
            }
        });
        holder.txtContinue.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (!TextUtils.isEmpty(holder.edPrice.getText().toString())) {
                    double temp = Double.parseDouble(holder.edPrice.getText().toString()) * Integer.parseInt(mainItem.getQuantity());
                    mainItem.setItemTotal(String.format("%.2f", temp));
                    listener.onClickimageUpload(mainItem, position);
                } else {
                    holder.edPrice.setError("");
                }
            }
        });
        holder.txtCancel.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                listener.onClickItmeUnavalible(mainItem, position);
            }
        });
    }

    @Override
    public int getItemCount() {
        return orderMainItemList.size();
    }
}
