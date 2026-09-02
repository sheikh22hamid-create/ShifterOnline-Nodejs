package com.shifter.driver.adepter;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.StringTokenizer;
import com.shifter.driver.R;
import com.shifter.driver.model.NotificationDataItem;

public class NotificationAdp extends RecyclerView.Adapter<NotificationAdp.MyViewHolder> {
    private final Context mContext;
    private final List<NotificationDataItem> categoryList;
    private final RecyclerTouchListener listener;
    public interface RecyclerTouchListener {
        void onNotiItem(String storeResult);
    }

    public class MyViewHolder extends RecyclerView.ViewHolder {
        public TextView title;
        public TextView txtSubtitel;
        public TextView txtDate;
        public ImageView thumbnail;
        public LinearLayout overflow;

        public MyViewHolder(View view) {
            super(view);
            title = view.findViewById(R.id.txt_title);
            txtSubtitel =  view.findViewById(R.id.txt_subtitel);
            txtDate = view.findViewById(R.id.txt_date);
            thumbnail = view.findViewById(R.id.imageView);
            overflow = view.findViewById(R.id.lvl_itemclick);
        }
    }

    public NotificationAdp(Context mContext, List<NotificationDataItem> categoryList, final RecyclerTouchListener listener) {
        this.mContext = mContext;
        this.categoryList = categoryList;
        this.listener = listener;
    }

    @Override
    public MyViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View itemView = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_notification, parent, false);
        return new MyViewHolder(itemView);
    }

    @Override
    public void onBindViewHolder(final MyViewHolder holder, int position) {

        NotificationDataItem storeResult = categoryList.get(position);
        holder.title.setText(storeResult.getTitle());
        holder.txtSubtitel.setText(storeResult.getMsg());
        StringTokenizer tk = new StringTokenizer(parseDateToddMMyyyy(storeResult.getDate()));
        String date = tk.nextToken();  // <---  yyyy-mm-dd
        String time = tk.nextToken();
        holder.txtDate.setText(date+"\n Time : "+time);
        Glide.with(mContext).load(R.drawable.ic_notification).into(holder.thumbnail);
        holder.overflow.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {

            }
        });
    }

    @Override
    public int getItemCount() {
        return categoryList.size();

    }

    public String parseDateToddMMyyyy(String time) {
        String inputPattern = "yyyy-MM-dd HH:mm:ss";
        String outputPattern = "dd-MMM-yy h:mm a";
        SimpleDateFormat inputFormat = new SimpleDateFormat(inputPattern);
        SimpleDateFormat outputFormat = new SimpleDateFormat(outputPattern);

        Date date = null;
        String str = null;

        try {
            date = inputFormat.parse(time);
            str = outputFormat.format(date);
        } catch (ParseException e) {
            e.printStackTrace();
        }


        return str;
    }

}
